/**
 * Standalone indexing CLI — строит векторный индекс документов.
 *
 * Подкоманды:
 *   index <file> --strategy <fixed|structural>   — проиндексировать файл одной стратегией
 *   eval                                          — прогнать ground-truth и сохранить отчёт
 *
 * Пример: bun run src/indexing.ts index scripts/day21/data/system-design-primer.md --strategy fixed
 */

import { readFileSync } from "node:fs";
import pc from "picocolors";

import { initDb } from "./db";
import { SqliteOptionsRepository } from "./storage/sqlite/options-repository";
import { SqliteVectorIndex } from "./storage/sqlite/sqlite-vector-index";
import { OllamaEmbedder } from "./api/ollama/ollama-embedder";
import { FixedSizeChunker } from "./domain/services/chunkers/fixed-size-chunker";
import { StructuralMarkdownChunker } from "./domain/services/chunkers/structural-markdown-chunker";
import { IndexingService } from "./domain/services/indexing-service";
import type { Chunker } from "./domain/ports/chunker";
import type { ChunkStrategy } from "./domain/models/chunking";

function fail(message: string): never {
  console.error(pc.red(message));
  process.exit(1);
}

const DEFAULTS = {
  fixedSize: 1500,
  fixedOverlap: 200,
  structuralPrimaryLevel: 2,
  structuralSplitLevel: 3,
  structuralMaxSize: 2000,
  embeddingProvider: "ollama",
  embeddingModel: "nomic-embed-text",
  embeddingBaseUrl: "http://localhost:11434",
  embeddingDim: 768,
} as const;

type IndexingConfig = {
  fixedSize: number;
  fixedOverlap: number;
  structuralPrimaryLevel: number;
  structuralSplitLevel: number;
  structuralMaxSize: number;
  embeddingProvider: string;
  embeddingModel: string;
  embeddingBaseUrl: string;
  embeddingDim: number;
};

function readIndexingConfig(options: SqliteOptionsRepository): IndexingConfig {
  const getInt = (key: string, fallback: number): number => {
    const raw = options.get(key);
    if (raw === null || raw === "") return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const getStr = (key: string, fallback: string): string => {
    const raw = options.get(key);
    return raw && raw.length > 0 ? raw : fallback;
  };
  return {
    fixedSize: getInt("indexing.chunk.fixed.size", DEFAULTS.fixedSize),
    fixedOverlap: getInt("indexing.chunk.fixed.overlap", DEFAULTS.fixedOverlap),
    structuralPrimaryLevel: getInt("indexing.chunk.structural.primaryLevel", DEFAULTS.structuralPrimaryLevel),
    structuralSplitLevel: getInt("indexing.chunk.structural.splitLevel", DEFAULTS.structuralSplitLevel),
    structuralMaxSize: getInt("indexing.chunk.structural.maxSize", DEFAULTS.structuralMaxSize),
    embeddingProvider: getStr("indexing.embeddings.provider", DEFAULTS.embeddingProvider),
    embeddingModel: getStr("indexing.embeddings.model", DEFAULTS.embeddingModel),
    embeddingBaseUrl: getStr("indexing.embeddings.baseUrl", DEFAULTS.embeddingBaseUrl),
    embeddingDim: getInt("indexing.embeddings.dim", DEFAULTS.embeddingDim),
  };
}

function parseArgs(argv: string[]): {
  subcommand: string;
  positional: string[];
  flags: Record<string, string>;
} {
  const [subcommand, ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string> = {};

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[name] = next;
        i += 1;
      } else {
        flags[name] = "true";
      }
    } else {
      positional.push(arg);
    }
  }
  return { subcommand: subcommand ?? "", positional, flags };
}

function usage(): never {
  console.error(
    [
      "Usage:",
      "  bun run src/indexing.ts index <file> --strategy <fixed|structural>",
      "  bun run src/indexing.ts eval",
    ].join("\n")
  );
  process.exit(1);
}

function buildChunker(strategy: ChunkStrategy, config: IndexingConfig): Chunker {
  switch (strategy) {
    case "fixed":
      return new FixedSizeChunker({ size: config.fixedSize, overlap: config.fixedOverlap });
    case "structural":
      return new StructuralMarkdownChunker({
        primaryLevel: config.structuralPrimaryLevel,
        splitLevel: config.structuralSplitLevel,
        maxSize: config.structuralMaxSize,
      });
    default:
      fail(`Неизвестная стратегия: ${strategy}`);
  }
}

async function runIndex(file: string, strategy: ChunkStrategy): Promise<void> {
  const historyDb = process.env.HISTORY_DB ?? "./data/history.db";
  initDb(historyDb);

  const optionsRepo = new SqliteOptionsRepository();
  const config = readIndexingConfig(optionsRepo);

  const text = readFileSync(file, "utf8");

  const chunker = buildChunker(strategy, config);
  const embedder = new OllamaEmbedder({
    baseUrl: config.embeddingBaseUrl,
    model: config.embeddingModel,
    dimension: config.embeddingDim,
  });
  const vectorIndex = new SqliteVectorIndex();

  const service = new IndexingService({ chunker, embedder, vectorIndex });

  console.log(pc.bold(`Индексация ${file}`));
  console.log(pc.dim(`  strategy=${strategy}`));
  if (strategy === "fixed") {
    console.log(pc.dim(`  chunker: size=${config.fixedSize}, overlap=${config.fixedOverlap}`));
  } else {
    console.log(
      pc.dim(
        `  chunker: primary=H${config.structuralPrimaryLevel}, split=H${config.structuralSplitLevel}, maxSize=${config.structuralMaxSize}`
      )
    );
  }
  console.log(pc.dim(`  embedder: ${config.embeddingProvider}/${config.embeddingModel} @ ${config.embeddingBaseUrl} (dim=${config.embeddingDim})`));

  const stats = await service.indexFile({ source: file, text, strategy, rebuild: true });

  const stored = vectorIndex.countByStrategy(strategy, file);

  console.log();
  console.log(pc.green("✔ Готово"));
  console.log(`  chunks:    ${stats.chunkCount}`);
  console.log(`  avg size:  ${stats.avgSize} chars`);
  console.log(`  min size:  ${stats.minSize} chars`);
  console.log(`  max size:  ${stats.maxSize} chars`);
  console.log(`  elapsed:   ${stats.elapsedMs} ms`);
  console.log(`  in db:     ${stored} rows (strategy=${strategy}, source=${file})`);
}

async function main() {
  const { subcommand, positional, flags } = parseArgs(Bun.argv.slice(2));

  if (!subcommand) usage();

  if (subcommand === "index") {
    const file = positional[0];
    if (!file) fail("Ожидается путь к файлу: index <file> --strategy <fixed|structural>");
    const strategy = (flags.strategy ?? "fixed") as ChunkStrategy;
    if (strategy !== "fixed" && strategy !== "structural") {
      fail(`--strategy должен быть fixed или structural, получено: ${strategy}`);
    }
    await runIndex(file, strategy);
    return;
  }

  if (subcommand === "eval") {
    fail("Команда eval пока не реализована (Phase 3).");
  }

  usage();
}

main().catch((err) => {
  console.error(pc.red("Ошибка индексации:"));
  console.error(err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) {
    console.error(pc.dim(err.stack));
  }
  process.exit(1);
});
