import { describe, test, expect } from "bun:test";

import { DocsIndexer, type IndexerEvent, type IndexerFileSystem } from "./docs-indexer";
import { FixedSizeChunker } from "./chunkers/fixed-size-chunker";
import { StructuralMarkdownChunker } from "./chunkers/structural-markdown-chunker";
import type { Chunker } from "../ports/chunker";
import type { Embedder } from "../ports/embedder";
import type { VectorIndex } from "../ports/vector-index";
import type { ChunkWithVector, VectorSearchHit } from "../models/chunking";

class StubEmbedder implements Embedder {
  readonly dimension = 4;
  embedded: string[] = [];
  async embed(texts: string[]): Promise<Float32Array[]> {
    this.embedded.push(...texts);
    return texts.map(() => new Float32Array([0.1, 0.2, 0.3, 0.4]));
  }
}

class StubVectorIndex implements VectorIndex {
  upserted: ChunkWithVector[] = [];
  deleted: Array<{ strategy: string; source?: string }> = [];
  upsert(chunks: ChunkWithVector[]): void {
    this.upserted.push(...chunks);
  }
  search(): VectorSearchHit[] {
    return [];
  }
  deleteByStrategy(strategy: "fixed" | "structural", source?: string): number {
    this.deleted.push({ strategy, source });
    return 0;
  }
  countByStrategy(): number {
    return 0;
  }
}

function fsFrom(files: Record<string, string>): IndexerFileSystem {
  return {
    async glob(_pattern: string, opts?: { ignore?: string[]; cwd?: string }): Promise<string[]> {
      const ignore = opts?.ignore ?? [];
      return Object.keys(files).filter((p) => {
        for (const ig of ignore) {
          const re = globToRegExp(ig);
          if (re.test(p)) return false;
        }
        return true;
      });
    },
    async readFile(path: string): Promise<string> {
      const content = files[path];
      if (content === undefined) throw new Error(`File not found in stub: ${path}`);
      return content;
    },
  };
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped.replace(/\*\*/g, "::DSTAR::").replace(/\*/g, "[^/]*").replace(/::DSTAR::/g, ".*");
  return new RegExp("^" + pattern + "$");
}

function makeIndexer(files: Record<string, string>): {
  indexer: DocsIndexer;
  embedder: StubEmbedder;
  vectorIndex: StubVectorIndex;
} {
  const embedder = new StubEmbedder();
  const vectorIndex = new StubVectorIndex();
  const chunkerByExt = new Map<string, Chunker>();
  chunkerByExt.set(".md", new StructuralMarkdownChunker({ primaryLevel: 2, splitLevel: 3, maxSize: 2000 }));
  chunkerByExt.set(".ts", new FixedSizeChunker({ size: 1500, overlap: 200 }));
  const indexer = new DocsIndexer({
    fileSystem: fsFrom(files),
    chunkerByExtension: chunkerByExt,
    embedder,
    vectorIndex,
    projectRoot: ".",
    includePatterns: ["README.md", "spring-boot-summary.md", "src/**/*.ts"],
    ignorePatterns: ["node_modules/**", ".git/**", "data/**", "**/*.test.ts", "**/*.d.ts"],
  });
  return { indexer, embedder, vectorIndex };
}

async function collectEvents(indexer: DocsIndexer): Promise<IndexerEvent[]> {
  const events: IndexerEvent[] = [];
  for await (const ev of indexer.reindex()) events.push(ev);
  return events;
}

describe("DocsIndexer", () => {
  test("indexes README.md and src/**/*.ts files", async () => {
    const { indexer, vectorIndex } = makeIndexer({
      "README.md": "# Title\n\n## Section A\n\nText A.\n\n## Section B\n\nText B.",
      "src/main.ts": "export function hello() { return 1; }\n",
    });
    const events = await collectEvents(indexer);

    const fileEvents = events.filter((e) => e.kind === "file");
    expect(fileEvents.length).toBe(2);
    const sources = fileEvents.map((e) => (e.kind === "file" ? e.path : "")).sort();
    expect(sources).toEqual(["README.md", "src/main.ts"]);

    expect(vectorIndex.upserted.length).toBeGreaterThan(0);
    const fixedChunks = vectorIndex.upserted.filter((c) => c.strategy === "fixed");
    const structuralChunks = vectorIndex.upserted.filter((c) => c.strategy === "structural");
    expect(fixedChunks.length).toBeGreaterThan(0);
    expect(structuralChunks.length).toBeGreaterThan(0);
  });

  test("ignore-list filters node_modules, .git, data, *.test.ts, *.d.ts", async () => {
    const { indexer, vectorIndex } = makeIndexer({
      "README.md": "# Hello",
      "src/main.ts": "export const x = 1;",
      "src/main.test.ts": "test('x', () => {});",
      "src/types.d.ts": "export type X = number;",
      "node_modules/foo.ts": "export const y = 2;",
      "data/cache.ts": "export const z = 3;",
      ".git/HEAD": "ref: master",
    });
    const events = await collectEvents(indexer);
    const fileEvents = events.filter((e) => e.kind === "file");
    const sources = fileEvents.map((e) => (e.kind === "file" ? e.path : "")).sort();
    expect(sources).toEqual(["README.md", "src/main.ts"]);
    for (const c of vectorIndex.upserted) {
      expect(c.source).not.toContain("test.ts");
      expect(c.source).not.toContain(".d.ts");
      expect(c.source).not.toContain("node_modules");
      expect(c.source).not.toContain(".git");
    }
  });

  test("md uses structural chunker, ts uses fixed chunker", async () => {
    const { indexer, vectorIndex } = makeIndexer({
      "README.md": "# H1\n\n## A\n\ntext\n\n## B\n\ntext",
      "src/main.ts": "// foo\nexport const x = 1;\n",
    });
    await collectEvents(indexer);
    const mdChunks = vectorIndex.upserted.filter((c) => c.source === "README.md");
    const tsChunks = vectorIndex.upserted.filter((c) => c.source === "src/main.ts");
    for (const c of mdChunks) expect(c.strategy).toBe("structural");
    for (const c of tsChunks) expect(c.strategy).toBe("fixed");
  });

  test("each chunk has lineStart and lineEnd with lineEnd >= lineStart", async () => {
    const { indexer, vectorIndex } = makeIndexer({
      "src/main.ts": "line1\nline2\nline3\nline4\nline5\n",
    });
    await collectEvents(indexer);
    expect(vectorIndex.upserted.length).toBeGreaterThan(0);
    for (const c of vectorIndex.upserted) {
      expect(c.lineStart).toBeDefined();
      expect(c.lineEnd).toBeDefined();
      expect(c.lineStart).toBeGreaterThanOrEqual(1);
      expect(c.lineEnd!).toBeGreaterThanOrEqual(c.lineStart!);
    }
  });

  test("empty file emits skipped event, not indexed", async () => {
    const { indexer, vectorIndex } = makeIndexer({
      "README.md": "",
      "src/main.ts": "export const x = 1;",
    });
    const events = await collectEvents(indexer);
    const skipped = events.filter((e) => e.kind === "skipped");
    expect(skipped.some((e) => e.kind === "skipped" && e.path === "README.md")).toBe(true);
    expect(vectorIndex.upserted.every((c) => c.source !== "README.md")).toBe(true);
  });

  test("unknown extension is skipped with reason", async () => {
    const { indexer, vectorIndex } = makeIndexer({
      "README.md": "# Hi",
      "src/data.json": '{"x":1}',
    });
    const events = await collectEvents(indexer);
    const skipped = events.filter((e) => e.kind === "skipped");
    expect(skipped.some((e) => e.kind === "skipped" && e.path === "src/data.json")).toBe(true);
    expect(vectorIndex.upserted.every((c) => c.source !== "src/data.json")).toBe(true);
  });

  test("emits done event with totals after all files", async () => {
    const { indexer } = makeIndexer({
      "README.md": "# H\n\n## A\n\ntext",
      "src/main.ts": "export const x = 1;",
    });
    const events = await collectEvents(indexer);
    const done = events.filter((e) => e.kind === "done");
    expect(done.length).toBe(1);
    if (done[0]?.kind === "done") {
      expect(done[0].totalFiles).toBe(2);
      expect(done[0].totalChunks).toBeGreaterThan(0);
    }
  });

  test("drop-and-reload: deletes existing chunks before indexing", async () => {
    const { indexer, vectorIndex } = makeIndexer({
      "README.md": "# Hi",
    });
    await collectEvents(indexer);
    expect(vectorIndex.deleted.length).toBeGreaterThanOrEqual(1);
    const strategies = new Set(vectorIndex.deleted.map((d) => d.strategy));
    expect(strategies.has("fixed")).toBe(true);
    expect(strategies.has("structural")).toBe(true);
  });
});
