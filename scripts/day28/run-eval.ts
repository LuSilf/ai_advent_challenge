import { readFileSync } from "node:fs";
import OpenAI from "openai";
import pc from "picocolors";

import { initDb } from "../../src/db";
import { SqliteOptionsRepository } from "../../src/storage/sqlite/options-repository";
import { SqliteModelRepository } from "../../src/storage/sqlite/model-repository";
import { OpenAILLMClient } from "../../src/api/openai/llm-client";
import { OllamaEmbedder } from "../../src/api/ollama/ollama-embedder";
import { SqliteVectorIndex } from "../../src/storage/sqlite/sqlite-vector-index";
import { readIndexingConfig } from "../../src/indexing-config";
import {
  DualBackendEvalService,
  type BackendConfig,
  type EvalMode,
  type AnswerRun,
  type RunMeta,
  type RunProgress,
} from "../../src/domain/services/dual-backend-eval-service";
import { DualJudgeService } from "../../src/domain/services/dual-judge-service";
import { RagJudgeService } from "../../src/domain/services/rag-judge-service";
import {
  aggregateByModeBackend,
  computeJudgeAgreement,
  findTopUnstable,
  type ModeBackendCell,
} from "../../src/domain/services/rag-dual-backend-stats";
import { renderDualBackendReport } from "../../src/domain/services/rag-dual-backend-report";
import { writeFileSync } from "node:fs";
import type { Model, ModelRole } from "../../src/domain/models";
import type { ModelRepository } from "../../src/domain/ports/model-repository";
import { LlmRerankerService } from "../../src/domain/services/llm-reranker-service";
import { QueryRewriteService } from "../../src/domain/services/query-rewrite-service";
import type { RagMode } from "../../src/domain/services/rag-pipeline-service";
import type { ControlQuestion } from "../../src/domain/services/rag-evaluation-service";

function fail(message: string): never {
  console.error(pc.red(message));
  process.exit(1);
}

type CliFlags = {
  questions?: number;
  modes?: string;
  runs?: number;
  report?: string;
  questionsPath?: string;
};

function parseArgs(argv: string[]): CliFlags {
  const flags: CliFlags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) continue;
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      if (name === "questions") flags.questions = Number(next);
      else if (name === "modes") flags.modes = next;
      else if (name === "runs") flags.runs = Number(next);
      else if (name === "report") flags.report = next;
      else if (name === "questions-path") flags.questionsPath = next;
      i += 1;
    }
  }
  return flags;
}

function getEnv(name: string, fallback?: string): string {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (fallback !== undefined) return fallback;
  fail(`Missing required env: ${name}`);
}

function parseFloatEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) {
    fail(`Invalid ${name} value: ${raw}. Must be in [${min}, ${max}]`);
  }
  return n;
}

function parseIntEnv(name: string, fallback: number, min: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) {
    fail(`Invalid ${name} value: ${raw}. Must be integer >= ${min}`);
  }
  return n;
}

async function pingOllama(baseUrl: string, requiredModel: string): Promise<void> {
  const url = `${baseUrl.replace(/\/$/, "")}/api/tags`;
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  } catch (err) {
    fail(`Ollama ping failed (${url}): ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!response.ok) {
    fail(`Ollama ping returned HTTP ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as { models?: Array<{ name?: string }> };
  const names = (data.models ?? []).map((m) => m.name ?? "").filter(Boolean);
  if (!names.includes(requiredModel)) {
    fail(
      `Ollama model "${requiredModel}" not loaded. Installed: ${names.join(", ") || "(none)"}.\n` +
      `Run: ollama pull ${requiredModel}`,
    );
  }
}

async function pingCloud(baseUrl: string, apiKey: string, requiredModel: string): Promise<void> {
  const url = `${baseUrl.replace(/\/$/, "")}/models`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    fail(`Cloud ping failed (${url}): ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!response.ok) {
    fail(`Cloud ping returned HTTP ${response.status} ${response.statusText} (${url})`);
  }
  const data = (await response.json()) as { data?: Array<{ id?: string }> };
  const names = (data.data ?? []).map((m) => m.id ?? "").filter(Boolean);
  if (names.length > 0 && !names.includes(requiredModel)) {
    console.warn(pc.yellow(`  ⚠ Cloud model "${requiredModel}" not in /models list (${names.length} models available)`));
  }
}

async function warmup(client: OpenAILLMClient, modelId: string): Promise<void> {
  try {
    await client.send({
      model: modelId,
      instructions: "",
      messages: [{ id: 0, sessionId: 0, role: "user", content: "Hi", createdAt: "" }],
      params: { stream: false, maxCompletionTokens: 5, temperature: 0 },
    });
  } catch (err) {
    console.warn(pc.yellow(`Warmup failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`));
  }
}

function buildModes(
  strategy: "fixed" | "structural",
  threshold: number,
  reranker: LlmRerankerService,
  queryRewriter: QueryRewriteService,
  selected?: Set<string>,
): EvalMode[] {
  const modes: EvalMode[] = [
    { name: "baseline" },
    {
      name: "rag-plain",
      rag: {
        name: "rag-plain",
        strategy,
        topKInitial: 3,
        topKFinal: 3,
      },
    },
    {
      name: "rag-threshold",
      rag: {
        name: "rag-threshold",
        strategy,
        topKInitial: 10,
        topKFinal: 3,
        threshold,
      },
    },
    {
      name: "rag-reranker",
      rag: {
        name: "rag-reranker",
        strategy,
        topKInitial: 10,
        topKFinal: 3,
        threshold,
        reranker,
      },
    },
    {
      name: "rag-full",
      rag: {
        name: "rag-full",
        strategy,
        topKInitial: 10,
        topKFinal: 3,
        threshold,
        reranker,
        queryRewriter,
      },
    },
  ];
  if (!selected) return modes;
  return modes.filter((m) => selected.has(m.name));
}

function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

async function main(): Promise<void> {
  const flags = parseArgs(Bun.argv.slice(2));

  const historyDb = getEnv("HISTORY_DB", "./data/history.db");
  initDb(historyDb);

  const optionsRepo = new SqliteOptionsRepository();
  const modelRepo = new SqliteModelRepository();

  const indexingConfig = readIndexingConfig(optionsRepo);
  const ollamaHost = getEnv("DAY28_LOCAL_OLLAMA_URL", "http://localhost:11434").replace(/\/$/, "");
  const localBaseUrl = `${ollamaHost}/v1`;
  const localModel = getEnv("DAY28_LOCAL_MODEL", "qwen3:4b-instruct-2507-q4_K_M");
  const cloudModel =
    process.env.DAY28_CLOUD_MODEL?.trim() ||
    modelRepo.getRole("chat")?.id ||
    "openai/gpt-5-nano";
  const runs = flags.runs ?? parseIntEnv("DAY28_RUNS", 3, 1);
  const temperature = parseFloatEnv("DAY28_TEMPERATURE", 0.2, 0, 2);
  const maxCompletionTokens = parseIntEnv("DAY28_MAX_TOKENS", 800, 16);
  const strategyRaw = (process.env.DAY28_STRATEGY?.trim() || "structural").toLowerCase();
  if (strategyRaw !== "structural" && strategyRaw !== "fixed") {
    fail(`Invalid DAY28_STRATEGY: ${strategyRaw}. Use structural|fixed`);
  }
  const strategy = strategyRaw as "structural" | "fixed";
  const threshold = parseFloatEnv("DAY28_THRESHOLD", 0.85, 0, 2);

  const cloudApiKey = getEnv("OPENAI_API_KEY");
  const cloudBaseUrl = (process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/$/, "");
  const cloudTimeoutMs = parseIntEnv("OPENAI_TIMEOUT_MS", 60000, 1);

  const questionsPath = flags.questionsPath ?? "scripts/day22/control-questions.json";
  let questions = JSON.parse(readFileSync(questionsPath, "utf8")) as ControlQuestion[];
  if (!Array.isArray(questions) || questions.length === 0) {
    fail(`${questionsPath} must contain a non-empty array of control questions`);
  }
  if (flags.questions !== undefined && Number.isInteger(flags.questions) && flags.questions > 0) {
    questions = questions.slice(0, flags.questions);
  }

  const localOpenAI = new OpenAI({ apiKey: "ollama", baseURL: localBaseUrl, maxRetries: 0 });
  const localLlmClient = new OpenAILLMClient(localOpenAI);
  const cloudOpenAI = new OpenAI({
    apiKey: cloudApiKey,
    baseURL: cloudBaseUrl,
    timeout: cloudTimeoutMs,
    maxRetries: 0,
  });
  const cloudLlmClient = new OpenAILLMClient(cloudOpenAI);

  const embedder = new OllamaEmbedder({
    baseUrl: indexingConfig.embeddingBaseUrl,
    model: indexingConfig.embeddingModel,
    dimension: indexingConfig.embeddingDim,
  });
  const vectorIndex = new SqliteVectorIndex();

  const indexCount = vectorIndex.countByStrategy(strategy);
  if (indexCount === 0) {
    fail(
      `Index for strategy=${strategy} is empty. Index a document first:\n` +
      `  bun run indexing index scripts/day21/data/system-design-primer.md --strategy ${strategy}`,
    );
  }

  console.log(pc.bold("Day 28 — Local RAG vs Cloud RAG evaluation"));
  console.log(pc.dim(`  strategy:      ${strategy} (${indexCount} chunks)`));
  console.log(pc.dim(`  local ollama:  ${ollamaHost}`));
  console.log(pc.dim(`  local model:   ${localModel}`));
  console.log(pc.dim(`  cloud baseURL: ${cloudBaseUrl}`));
  console.log(pc.dim(`  cloud model:   ${cloudModel}`));
  console.log(pc.dim(`  runs:          ${runs}`));
  console.log(pc.dim(`  temperature:   ${temperature}`));
  console.log(pc.dim(`  max tokens:    ${maxCompletionTokens}`));
  console.log(pc.dim(`  threshold:     ${threshold}`));
  console.log(pc.dim(`  questions:     ${questions.length} (from ${questionsPath})`));

  const selectedModeNames = flags.modes ? new Set(flags.modes.split(",").map((s) => s.trim())) : undefined;
  const reranker = new LlmRerankerService({ baseUrl: ollamaHost, model: localModel }, 0.3);
  const queryRewriter = new QueryRewriteService({ baseUrl: ollamaHost, model: localModel });
  const modes = buildModes(strategy, threshold, reranker, queryRewriter, selectedModeNames);
  if (modes.length === 0) {
    fail(`No modes selected. --modes filter: ${flags.modes}`);
  }
  console.log(pc.dim(`  modes:         ${modes.map((m) => m.name).join(", ")}`));

  console.log(pc.bold("\nPhase 0: fail-fast checks"));
  await pingOllama(ollamaHost, localModel);
  console.log(pc.green(`  ✓ Ollama ok, model "${localModel}" available`));
  await pingCloud(cloudBaseUrl, cloudApiKey, cloudModel);
  console.log(pc.green(`  ✓ Cloud ok, model "${cloudModel}" responded`));

  console.log(pc.bold("\nPhase 1: warmup"));
  const warmStart = Date.now();
  await warmup(localLlmClient, localModel);
  console.log(pc.dim(`  local warmup done in ${formatLatency(Date.now() - warmStart)}`));

  const backends: BackendConfig[] = [
    { name: "local", llmClient: localLlmClient, modelId: localModel },
    { name: "cloud", llmClient: cloudLlmClient, modelId: cloudModel },
  ];

  const totalRuns = questions.length * modes.length * backends.length * runs;
  console.log(pc.bold(`\nPhase 2: generation (${totalRuns} runs)`));

  const service = new DualBackendEvalService(embedder, vectorIndex);
  const startedAt = Date.now();
  const results = await service.run({
    questions,
    modes,
    backends,
    runs,
    temperature,
    maxCompletionTokens,
    observer: {
      onRunStart: (meta: RunMeta, progress: RunProgress) => {
        process.stdout.write(
          pc.dim(`  [${progress.index}/${progress.totalRuns}] ${meta.questionId} · ${meta.modeName} · ${meta.backendName} · run ${meta.runIndex} ... `),
        );
      },
      onRunDone: (run: AnswerRun) => {
        if (run.error) {
          process.stdout.write(pc.red(`ERR ${run.errorClass} (${formatLatency(run.latencyMs)})\n`));
        } else {
          process.stdout.write(pc.dim(`ok ${formatLatency(run.latencyMs)}\n`));
        }
      },
    },
  });

  const elapsed = Date.now() - startedAt;
  const successful = results.filter((r) => !r.error);
  const failed = results.filter((r) => r.error);
  const localRuns = results.filter((r) => r.backendName === "local" && !r.error);
  const cloudRuns = results.filter((r) => r.backendName === "cloud" && !r.error);
  const avg = (arr: number[]): number =>
    arr.length === 0 ? 0 : Math.round(arr.reduce((s, v) => s + v, 0) / arr.length);

  console.log(pc.bold("\nPhase 2 summary"));
  console.log(pc.dim(`  elapsed:       ${formatLatency(elapsed)}`));
  console.log(pc.dim(`  successful:    ${successful.length}/${results.length}`));
  console.log(pc.dim(`  failed:        ${failed.length}`));
  console.log(pc.dim(`  avg local ms:  ${avg(localRuns.map((r) => r.latencyMs))}`));
  console.log(pc.dim(`  avg cloud ms:  ${avg(cloudRuns.map((r) => r.latencyMs))}`));

  if (failed.length > 0) {
    console.log(pc.yellow("\nFailures:"));
    const byClass = new Map<string, number>();
    for (const f of failed) {
      const k = f.errorClass ?? "unknown";
      byClass.set(k, (byClass.get(k) ?? 0) + 1);
    }
    for (const [cls, n] of byClass.entries()) {
      console.log(pc.dim(`  ${cls}: ${n}`));
    }
  }

  const cloudJudgeModel =
    process.env.DAY28_CLOUD_JUDGE_MODEL?.trim() ||
    modelRepo.getRole("judge")?.id ||
    cloudModel;
  const cloudJudge = new RagJudgeService(cloudLlmClient, modelRepo);
  const localJudgeRepo = staticModelRepo(localModel);
  const localJudge = new RagJudgeService(localLlmClient, localJudgeRepo);
  const dualJudgeService = new DualJudgeService(cloudJudge, localJudge);

  console.log(pc.bold(`\nPhase 3: dual judge (${results.length * 2} calls)`));
  console.log(pc.dim(`  cloud judge:   ${cloudJudgeModel}`));
  console.log(pc.dim(`  local judge:   ${localModel}`));

  const judgeStarted = Date.now();
  const judged = await dualJudgeService.judgeAll(results, questions, {
    onJudgeStart: (meta, progress) => {
      process.stdout.write(
        pc.dim(`  [${progress.index}/${progress.total}] judge ${meta.questionId} · ${meta.modeName} · ${meta.backendName} · run ${meta.runIndex} ... `),
      );
    },
    onJudgeDone: (j) => {
      const cloudPart = j.cloudJudge ? `C=${j.cloudJudge.score}` : pc.red("C=ERR");
      const localPart = j.localJudge ? `L=${j.localJudge.score}` : pc.red("L=ERR");
      process.stdout.write(pc.dim(`${cloudPart} ${localPart}\n`));
    },
  });
  const judgeElapsed = Date.now() - judgeStarted;

  const cloudJudgeErrors = judged.filter((j) => j.cloudJudgeError).length;
  const localJudgeErrors = judged.filter((j) => j.localJudgeError).length;
  const bothScored = judged.filter((j) => j.cloudJudge && j.localJudge).length;

  console.log(pc.bold("\nPhase 3 summary"));
  console.log(pc.dim(`  elapsed:       ${formatLatency(judgeElapsed)}`));
  console.log(pc.dim(`  both scored:   ${bothScored}/${judged.length}`));
  console.log(pc.dim(`  cloud errors:  ${cloudJudgeErrors}`));
  console.log(pc.dim(`  local errors:  ${localJudgeErrors}`));

  console.log(pc.bold("\nPhase 4: aggregation"));
  const cells = aggregateByModeBackend(judged);
  printCellsTable(cells);

  const judgePairs: Array<[number, number]> = judged
    .filter((j) => j.cloudJudge && j.localJudge)
    .map((j) => [j.cloudJudge!.score, j.localJudge!.score]);
  const agreement = computeJudgeAgreement(judgePairs);
  console.log(pc.bold("\nDual-judge agreement"));
  console.log(pc.dim(`  pairs:   ${agreement.count}`));
  console.log(pc.dim(`  exact:   ${agreement.exact}`));
  console.log(pc.dim(`  ±1:      ${agreement.within1}`));
  console.log(pc.dim(`  ≥2:      ${agreement.off2plus}`));
  console.log(pc.dim(`  pearson: ${agreement.pearson === null ? "—" : agreement.pearson.toFixed(3)}`));

  const topJudgeUnstable = findTopUnstable(judged, "judge", 3);
  const topLatencyUnstable = findTopUnstable(judged, "latency", 3);
  if (topJudgeUnstable.length > 0) {
    console.log(pc.bold("\nTop-3 unstable by judge std"));
    for (const row of topJudgeUnstable) {
      console.log(pc.dim(`  ${row.questionId} · ${row.modeName} · ${row.backendName}: stdC=${fmt(row.stdCloud)} stdL=${fmt(row.stdLocal)}`));
    }
  }
  if (topLatencyUnstable.length > 0) {
    console.log(pc.bold("\nTop-3 unstable by latency std"));
    for (const row of topLatencyUnstable) {
      console.log(pc.dim(`  ${row.questionId} · ${row.modeName} · ${row.backendName}: mean=${fmt(row.meanLatency)}ms std=${fmt(row.stdLatency)}`));
    }
  }

  console.log(pc.bold("\nPhase 5: render report"));
  const reportPath = flags.report ?? "scripts/day28/report.md";
  const report = renderDualBackendReport({
    runs: judged,
    questions,
    options: {
      generatedAt: new Date().toISOString(),
      strategy,
      localModel,
      cloudModel,
      runsPerCell: runs,
      temperature,
    },
  });
  writeFileSync(reportPath, report, "utf8");
  console.log(pc.green(`  ✓ Report saved: ${reportPath}`));

  console.log(pc.bold("\nDone"));
  console.log(pc.dim(`  total elapsed: ${formatLatency(Date.now() - startedAt)}`));
}

function fmt(v: number | null): string {
  if (v === null) return "—";
  return v.toFixed(2);
}

function printCellsTable(cells: ModeBackendCell[]): void {
  console.log(pc.dim("  mode          backend  C-judge  L-judge  p50(ms)  p95(ms)  err"));
  for (const c of cells) {
    const cAvg = c.cloudJudgeAvg === null ? "—" : c.cloudJudgeAvg.toFixed(2);
    const lAvg = c.localJudgeAvg === null ? "—" : c.localJudgeAvg.toFixed(2);
    const p50 = c.latency.p50 === null ? "—" : Math.round(c.latency.p50).toString();
    const p95 = c.latency.p95 === null ? "—" : Math.round(c.latency.p95).toString();
    console.log(
      pc.dim(
        `  ${c.modeName.padEnd(13)} ${c.backendName.padEnd(7)} ${cAvg.padEnd(7)} ${lAvg.padEnd(7)} ${p50.padEnd(8)} ${p95.padEnd(8)} ${c.errors}`,
      ),
    );
  }
}

function staticModelRepo(modelId: string): ModelRepository {
  const model: Model = {
    id: modelId,
    name: modelId,
    inputPrice: 0,
    outputPrice: 0,
    contextSize: 0,
  };
  return {
    getAll: (): Model[] => [model],
    getById: (id: string): Model | null => (id === modelId ? model : null),
    getRole: (role: string): Model | null =>
      role === "judge" || role === "chat" ? model : null,
    getRoles: (): (ModelRole & { modelName: string })[] => [],
    setRole: (): void => {
      throw new Error("static repo: setRole not supported");
    },
  };
}

main().catch((error) => {
  console.error(pc.red("Day 28 eval failed"));
  console.error(error instanceof Error ? error.message : String(error));
  if (error instanceof Error && error.stack) {
    console.error(pc.dim(error.stack));
  }
  process.exit(1);
});
