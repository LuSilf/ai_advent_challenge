import { extname } from "node:path";

import type { Chunker } from "../ports/chunker";
import type { Embedder } from "../ports/embedder";
import type { VectorIndex } from "../ports/vector-index";
import type { Chunk, ChunkStrategy, ChunkWithVector } from "../models/chunking";

export type IndexerEvent =
  | { kind: "file"; path: string; chunks: number }
  | { kind: "skipped"; path: string; reason: string }
  | { kind: "done"; totalFiles: number; totalChunks: number };

export type IndexerFileSystem = {
  glob(pattern: string, opts?: { ignore?: string[]; cwd?: string }): Promise<string[]>;
  readFile(path: string): Promise<string>;
};

export type DocsIndexerDeps = {
  fileSystem: IndexerFileSystem;
  chunkerByExtension: Map<string, Chunker>;
  embedder: Embedder;
  vectorIndex: VectorIndex;
  projectRoot: string;
  includePatterns: string[];
  ignorePatterns: string[];
};

const DEFAULT_BATCH_SIZE = 16;

export class DocsIndexer {
  constructor(private readonly deps: DocsIndexerDeps) {}

  async *reindex(): AsyncIterable<IndexerEvent> {
    const { fileSystem, chunkerByExtension, embedder, vectorIndex, projectRoot, includePatterns, ignorePatterns } =
      this.deps;

    const seen = new Set<string>();
    const files: string[] = [];
    for (const pattern of includePatterns) {
      const matched = await fileSystem.glob(pattern, { ignore: ignorePatterns, cwd: projectRoot });
      for (const path of matched) {
        if (!seen.has(path)) {
          seen.add(path);
          files.push(path);
        }
      }
    }
    files.sort();

    vectorIndex.deleteByStrategy("fixed");
    vectorIndex.deleteByStrategy("structural");

    let totalFiles = 0;
    let totalChunks = 0;

    for (const path of files) {
      const ext = extname(path);
      const chunker = chunkerByExtension.get(ext);
      if (!chunker) {
        yield { kind: "skipped", path, reason: `unknown extension ${ext}` };
        continue;
      }

      let text: string;
      try {
        text = await fileSystem.readFile(path);
      } catch (err) {
        yield { kind: "skipped", path, reason: `read error: ${err instanceof Error ? err.message : String(err)}` };
        continue;
      }

      if (text.trim().length === 0) {
        yield { kind: "skipped", path, reason: "empty file" };
        continue;
      }

      const chunks = chunker.chunk(text, path);
      if (chunks.length === 0) {
        yield { kind: "skipped", path, reason: "no chunks produced" };
        continue;
      }

      const lineMap = buildLineMap(text);
      const enriched = chunks.map((c) => ({
        ...c,
        lineStart: charToLine(c.charStart, lineMap),
        lineEnd: charToLine(Math.max(c.charEnd - 1, c.charStart), lineMap),
      }));

      for (let i = 0; i < enriched.length; i += DEFAULT_BATCH_SIZE) {
        const batch = enriched.slice(i, i + DEFAULT_BATCH_SIZE);
        const vectors = await embedder.embed(batch.map((c) => c.text));
        const withVectors: ChunkWithVector[] = batch.map((c, idx) => ({
          ...c,
          embedding: vectors[idx]!,
        }));
        vectorIndex.upsert(withVectors);
      }

      totalFiles += 1;
      totalChunks += enriched.length;
      yield { kind: "file", path, chunks: enriched.length };
    }

    yield { kind: "done", totalFiles, totalChunks };
  }
}

function buildLineMap(text: string): number[] {
  const offsets: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) {
      offsets.push(i + 1);
    }
  }
  return offsets;
}

function charToLine(charOffset: number, lineMap: number[]): number {
  let lo = 0;
  let hi = lineMap.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (lineMap[mid]! <= charOffset) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo + 1;
}

export type { Chunk, ChunkStrategy };
