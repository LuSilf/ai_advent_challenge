import pc from "picocolors";

import { DocsIndexer, type IndexerEvent } from "../../domain/services/docs-indexer";
import { FixedSizeChunker } from "../../domain/services/chunkers/fixed-size-chunker";
import { StructuralMarkdownChunker } from "../../domain/services/chunkers/structural-markdown-chunker";
import { OllamaEmbedder } from "../../api/ollama/ollama-embedder";
import { SqliteVectorIndex } from "../../storage/sqlite/sqlite-vector-index";
import type { Chunker } from "../../domain/ports/chunker";
import type { AssistantConfig } from "../../domain/services/assistant-config";

import { createBunGlobFs } from "./bun-glob-fs";

const INCLUDE_PATTERNS = ["README.md", "spring-boot-summary.md", "src/**/*.ts"];
const IGNORE_PATTERNS = [
  "node_modules/**",
  ".git/**",
  "data/**",
  "**/*.lock",
  "**/*.test.ts",
  "**/*.d.ts",
];
const EMBEDDING_DIMENSION = 768;

export function buildDocsIndexer(config: AssistantConfig): DocsIndexer {
  const fileSystem = createBunGlobFs(config.projectRoot);
  const chunkerByExt = new Map<string, Chunker>();
  chunkerByExt.set(".md", new StructuralMarkdownChunker({ primaryLevel: 2, splitLevel: 3, maxSize: 2000 }));
  chunkerByExt.set(".ts", new FixedSizeChunker({ size: 1500, overlap: 200 }));
  const embedder = new OllamaEmbedder({
    baseUrl: config.embeddingBaseUrl,
    model: config.embeddingModel,
    dimension: EMBEDDING_DIMENSION,
  });
  const vectorIndex = new SqliteVectorIndex();
  return new DocsIndexer({
    fileSystem,
    chunkerByExtension: chunkerByExt,
    embedder,
    vectorIndex,
    projectRoot: config.projectRoot,
    includePatterns: INCLUDE_PATTERNS,
    ignorePatterns: IGNORE_PATTERNS,
  });
}

export async function runReindex(indexer: DocsIndexer, output: NodeJS.WritableStream): Promise<void> {
  const started = performance.now();
  for await (const event of indexer.reindex()) {
    output.write(formatEvent(event) + "\n");
  }
  const elapsed = Math.round(performance.now() - started);
  output.write(pc.dim(`[reindex] elapsed ${elapsed}ms\n`));
}

function formatEvent(ev: IndexerEvent): string {
  switch (ev.kind) {
    case "file":
      return pc.green(`indexed ${ev.path} (${ev.chunks} chunks)`);
    case "skipped":
      return pc.dim(`skipped ${ev.path}: ${ev.reason}`);
    case "done":
      return pc.bold(pc.green(`done — ${ev.totalFiles} files, ${ev.totalChunks} chunks`));
  }
}
