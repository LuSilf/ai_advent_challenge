/**
 * Standalone indexing CLI — строит векторный индекс документов.
 *
 * Подкоманды:
 *   index <file> --strategy <fixed|structural>   — проиндексировать файл одной стратегией
 *   eval                                          — прогнать ground-truth и сохранить отчёт
 *
 * Пример: bun run src/indexing.ts index scripts/day21/data/system-design-primer.md --strategy fixed
 */

import { readFileSync, writeFileSync } from "node:fs";
import pc from "picocolors";

import { initDb, getDb } from "./db";
import { SqliteOptionsRepository } from "./storage/sqlite/options-repository";
import { SqliteVectorIndex } from "./storage/sqlite/sqlite-vector-index";
import { OllamaEmbedder } from "./api/ollama/ollama-embedder";
import { FixedSizeChunker } from "./domain/services/chunkers/fixed-size-chunker";
import { StructuralMarkdownChunker } from "./domain/services/chunkers/structural-markdown-chunker";
import { IndexingService } from "./domain/services/indexing-service";
import { readIndexingConfig, type IndexingConfig } from "./indexing-config";
import {
  evaluateQuery,
  isHit,
  computeRecallAt3,
  computeMRR,
  type EvalQuery,
  type QueryResult,
  type StrategyReport,
} from "./domain/services/evaluation-service";
import type { Chunker } from "./domain/ports/chunker";
import type { ChunkStrategy } from "./domain/models/chunking";

function fail(message: string): never {
  console.error(pc.red(message));
  process.exit(1);
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

  const observer = {
    onChunksReady: (chunks: import("./domain/models/chunking").Chunk[]) => {
      console.log();
      console.log(pc.bold(`Чанков получено: ${chunks.length}`));
      for (const c of chunks) {
        const idx = `#${String(c.chunkIndex).padStart(3, " ")}`;
        const size = `${String(c.text.length).padStart(4, " ")}ch`;
        const section = c.section ? pc.cyan(c.section) : pc.dim("(no section)");
        const snippet = c.text.replace(/\s+/g, " ").trim().slice(0, 70);
        console.log(`  ${pc.dim(idx)} ${pc.yellow(size)} ${section}`);
        console.log(`      ${pc.dim(snippet)}${c.text.length > 70 ? pc.dim("…") : ""}`);
      }
      console.log();
      console.log(pc.bold("Эмбеддинг:"));
    },
    onBatchStart: (batchIndex: number, totalBatches: number, batchSize: number) => {
      process.stdout.write(
        pc.dim(`  батч ${batchIndex + 1}/${totalBatches} (${batchSize} чанков)... `)
      );
    },
    onBatchDone: (_batchIndex: number, _totalBatches: number, elapsedMs: number) => {
      console.log(pc.dim(`готово за ${elapsedMs} ms`));
    },
  };

  const stats = await service.indexFile({
    source: file,
    text,
    strategy,
    rebuild: true,
    observer,
  });

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
    const queriesPath = positional[0] ?? "scripts/day21/test-queries.json";
    const reportPath = flags.report ?? "scripts/day21/report.md";
    await runEval(queriesPath, reportPath);
    return;
  }

  usage();
}

type StrategyStats = {
  chunkCount: number;
  avgSize: number;
  minSize: number;
  maxSize: number;
};

function strategyStats(_vectorIndex: SqliteVectorIndex, strategy: ChunkStrategy): StrategyStats {
  const row = getDb()
    .query<
      { c: number; avg: number | null; min: number | null; max: number | null },
      [string]
    >(
      `SELECT COUNT(*) c, AVG(LENGTH(text)) avg, MIN(LENGTH(text)) min, MAX(LENGTH(text)) max
       FROM chunks WHERE strategy = ?`
    )
    .get(strategy);
  return {
    chunkCount: row?.c ?? 0,
    avgSize: Math.round(row?.avg ?? 0),
    minSize: row?.min ?? 0,
    maxSize: row?.max ?? 0,
  };
}

async function runEval(queriesPath: string, reportPath: string): Promise<void> {
  const historyDb = process.env.HISTORY_DB ?? "./data/history.db";
  initDb(historyDb);

  const optionsRepo = new SqliteOptionsRepository();
  const config = readIndexingConfig(optionsRepo);

  const vectorIndex = new SqliteVectorIndex();
  const fixedCount = vectorIndex.countByStrategy("fixed");
  const structuralCount = vectorIndex.countByStrategy("structural");
  if (fixedCount === 0 || structuralCount === 0) {
    fail(
      `Индекс неполон: fixed=${fixedCount}, structural=${structuralCount}. ` +
        `Запустите сначала:\n  bun run indexing index <file> --strategy fixed\n  bun run indexing index <file> --strategy structural`
    );
  }

  const raw = readFileSync(queriesPath, "utf8");
  const queries = JSON.parse(raw) as EvalQuery[];
  if (!Array.isArray(queries) || queries.length === 0) {
    fail(`${queriesPath} должен содержать непустой массив запросов`);
  }

  const embedder = new OllamaEmbedder({
    baseUrl: config.embeddingBaseUrl,
    model: config.embeddingModel,
    dimension: config.embeddingDim,
  });

  console.log(pc.bold(`Оценка индекса на ${queries.length} запросах`));
  console.log(pc.dim(`  embedder: ${config.embeddingProvider}/${config.embeddingModel} (dim=${config.embeddingDim})`));
  console.log(pc.dim(`  fixed chunks: ${fixedCount}, structural chunks: ${structuralCount}`));

  const queryVectors = await embedder.embed(queries.map((q) => q.query));

  const strategies: ChunkStrategy[] = ["fixed", "structural"];
  const resultsByStrategy: Record<ChunkStrategy, QueryResult[]> = {
    fixed: [],
    structural: [],
  };

  for (let i = 0; i < queries.length; i++) {
    const query = queries[i]!;
    const vec = queryVectors[i]!;

    console.log();
    console.log(pc.bold(pc.cyan(`[${query.id}]`) + " " + query.query));
    const expectedParts: string[] = [];
    if (query.expected_section_contains?.length) {
      expectedParts.push(`section ∋ ${query.expected_section_contains.map((s) => `"${s}"`).join(" | ")}`);
    }
    if (query.expected_keywords?.length) {
      expectedParts.push(`keywords ∋ ${query.expected_keywords.map((k) => `"${k}"`).join(" | ")}`);
    }
    if (expectedParts.length > 0) {
      console.log(pc.dim(`  expected: ${expectedParts.join("  OR  ")}`));
    }

    for (const strategy of strategies) {
      const hits = vectorIndex.search(vec, 3, { strategy });
      const result = evaluateQuery(hits, query);
      resultsByStrategy[strategy].push(result);

      const verdict =
        result.firstHitRank > 0
          ? pc.green(`HIT @${result.firstHitRank}`)
          : pc.red("MISS");
      console.log(`  ${pc.yellow(strategy.padEnd(10))} → ${verdict}`);

      for (let k = 0; k < hits.length; k++) {
        const h = hits[k]!;
        const matched = isHit(h, query);
        const marker = matched ? pc.green("✓") : pc.dim("·");
        const rank = `${k + 1}.`;
        const section = h.section ? h.section : pc.dim("(no section)");
        const dist = pc.dim(`d=${h.distance.toFixed(3)}`);
        const snippet = h.text.replace(/\s+/g, " ").trim().slice(0, 100);
        const line = `    ${marker} ${rank} ${section} ${dist}`;
        console.log(matched ? pc.green(line) : line);
        console.log(pc.dim(`        ${snippet}${h.text.length > 100 ? "…" : ""}`));
      }
    }
  }

  const reports: StrategyReport[] = strategies.map((strategy) => ({
    strategy,
    recallAt3: computeRecallAt3(resultsByStrategy[strategy]),
    mrr: computeMRR(resultsByStrategy[strategy]),
    queryResults: resultsByStrategy[strategy],
  }));

  const stats: Record<ChunkStrategy, StrategyStats> = {
    fixed: strategyStats(vectorIndex, "fixed"),
    structural: strategyStats(vectorIndex, "structural"),
  };

  console.log();
  console.log(pc.bold("Итоги:"));
  for (const report of reports) {
    console.log(
      `  ${pc.yellow(report.strategy.padEnd(10))} Recall@3=${(report.recallAt3 * 100).toFixed(1)}%  MRR=${report.mrr.toFixed(3)}`
    );
  }

  const md = renderReport(queries, reports, stats, config);
  writeFileSync(reportPath, md, "utf8");
  console.log();
  console.log(pc.green(`✔ Отчёт сохранён: ${reportPath}`));
}

function renderReport(
  queries: EvalQuery[],
  reports: StrategyReport[],
  stats: Record<ChunkStrategy, StrategyStats>,
  config: IndexingConfig
): string {
  const lines: string[] = [];
  lines.push("# Day 21 — Indexing comparison report");
  lines.push("");
  lines.push(`Embedder: **${config.embeddingProvider}/${config.embeddingModel}** (dim=${config.embeddingDim})`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Strategy | Chunks | Avg size | Min size | Max size | Recall@3 | MRR |");
  lines.push("|----------|-------:|---------:|---------:|---------:|---------:|----:|");
  for (const r of reports) {
    const s = stats[r.strategy as ChunkStrategy];
    lines.push(
      `| ${r.strategy} | ${s.chunkCount} | ${s.avgSize} | ${s.minSize} | ${s.maxSize} | ${(r.recallAt3 * 100).toFixed(1)}% | ${r.mrr.toFixed(3)} |`
    );
  }
  lines.push("");
  lines.push("## Per-query results");
  lines.push("");
  lines.push("| # | Query | fixed rank | structural rank |");
  lines.push("|---|-------|-----------:|----------------:|");
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i]!;
    const fixed = reports.find((r) => r.strategy === "fixed")!.queryResults[i]!;
    const structural = reports.find((r) => r.strategy === "structural")!.queryResults[i]!;
    const fRank = fixed.firstHitRank === 0 ? "—" : fixed.firstHitRank;
    const sRank = structural.firstHitRank === 0 ? "—" : structural.firstHitRank;
    lines.push(`| ${q.id} | ${escapeMdCell(q.query)} | ${fRank} | ${sRank} |`);
  }

  lines.push("");
  lines.push("## Qualitative examples");
  lines.push("");
  const examples = queries.slice(0, 3);
  for (let i = 0; i < examples.length; i++) {
    const q = examples[i]!;
    lines.push(`### ${q.id}: ${q.query}`);
    lines.push("");
    for (const r of reports) {
      lines.push(`**${r.strategy}:**`);
      lines.push("");
      const qr = r.queryResults[i]!;
      for (let k = 0; k < qr.hits.length; k++) {
        const h = qr.hits[k]!;
        const section = h.section ?? "(no section)";
        const snippet = h.text.replace(/\s+/g, " ").trim().slice(0, 160);
        lines.push(`${k + 1}. \`${section}\` — ${snippet}${h.text.length > 160 ? "…" : ""}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n") + "\n";
}

function escapeMdCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

main().catch((err) => {
  console.error(pc.red("Ошибка индексации:"));
  console.error(err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) {
    console.error(pc.dim(err.stack));
  }
  process.exit(1);
});
