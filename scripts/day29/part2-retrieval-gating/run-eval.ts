import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import OpenAI from "openai";
import pc from "picocolors";

import { initDb } from "../../../src/db";
import { SqliteOptionsRepository } from "../../../src/storage/sqlite/options-repository";
import { SqliteModelRepository } from "../../../src/storage/sqlite/model-repository";
import { OpenAILLMClient } from "../../../src/api/openai/llm-client";
import { OllamaEmbedder } from "../../../src/api/ollama/ollama-embedder";
import { SqliteVectorIndex } from "../../../src/storage/sqlite/sqlite-vector-index";
import { readIndexingConfig } from "../../../src/indexing-config";
import {
  DualBackendEvalService,
  type BackendConfig,
  type EvalMode,
  type AnswerRun,
  type RunMeta,
  type RunProgress,
} from "../../../src/domain/services/dual-backend-eval-service";
import { DualJudgeService } from "../../../src/domain/services/dual-judge-service";
import { RagJudgeService } from "../../../src/domain/services/rag-judge-service";
import { LlmRerankerService } from "../../../src/domain/services/llm-reranker-service";
import { QueryRewriteService } from "../../../src/domain/services/query-rewrite-service";
import { detectRefusal, type RefusalQuestion, type RefusalResult } from "../../../src/domain/services/refusal-detector";
import { RetrievalRefusalPolicy } from "../../../src/domain/services/retrieval-refusal-policy";
import type { Model, ModelRole } from "../../../src/domain/models";
import type { ModelRepository } from "../../../src/domain/ports/model-repository";
import type { ControlQuestion } from "../../../src/domain/services/rag-evaluation-service";

import { PART2_CONFIGS, PART2_QUESTION_IDS, type Day29Part2Config } from "./configs";
import { captureVramSnapshot } from "../vram";

type OosQuestion = ControlQuestion & { outOfScope?: boolean; topicalTerms?: string[] };
type CliFlags = { config?: string };

function parseArgs(argv: string[]): CliFlags {
  const flags: CliFlags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) continue;
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      if (name === "config") flags.config = next;
      i += 1;
    }
  }
  return flags;
}

function fail(message: string): never {
  console.error(pc.red(message));
  process.exit(1);
}

function getEnv(name: string, fallback?: string): string {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (fallback !== undefined) return fallback;
  fail(`Missing required env: ${name}`);
}

function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

async function pingOllama(baseUrl: string, requiredModel: string): Promise<void> {
  const url = `${baseUrl.replace(/\/$/, "")}/api/tags`;
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) fail(`Ollama ping: HTTP ${response.status}`);
  const data = (await response.json()) as { models?: Array<{ name?: string }> };
  const names = (data.models ?? []).map((m) => m.name ?? "").filter(Boolean);
  if (!names.includes(requiredModel)) {
    fail(`Ollama model "${requiredModel}" not loaded. Installed: ${names.join(", ")}`);
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
  reranker: LlmRerankerService,
  queryRewriter: QueryRewriteService,
  strategy: "fixed" | "structural",
  threshold: number,
  gatingThreshold: number | null,
): EvalMode[] {
  const refusalPolicy = gatingThreshold !== null ? new RetrievalRefusalPolicy(gatingThreshold) : undefined;
  return [
    { name: "baseline" },
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
        refusalPolicy,
      },
    },
  ];
}

function staticModelRepo(modelId: string): ModelRepository {
  const model: Model = { id: modelId, name: modelId, inputPrice: 0, outputPrice: 0, contextSize: 0 };
  return {
    getAll: (): Model[] => [model],
    getById: (id: string): Model | null => (id === modelId ? model : null),
    getRole: (role: string): Model | null => (role === "judge" || role === "chat" ? model : null),
    getRoles: (): (ModelRole & { modelName: string })[] => [],
    setRole: (): void => {
      throw new Error("static repo: setRole not supported");
    },
  };
}

async function main(): Promise<void> {
  const flags = parseArgs(Bun.argv.slice(2));
  const configName = flags.config ?? "d0";
  const config = PART2_CONFIGS[configName];
  if (!config) fail(`Unknown config "${configName}". Available: ${Object.keys(PART2_CONFIGS).join(", ")}`);

  const historyDb = getEnv("HISTORY_DB", "./data/history.db");
  initDb(historyDb);

  const optionsRepo = new SqliteOptionsRepository();
  const modelRepo = new SqliteModelRepository();
  const indexingConfig = readIndexingConfig(optionsRepo);

  const ollamaHost = getEnv("DAY29_LOCAL_OLLAMA_URL", "http://localhost:11434").replace(/\/$/, "");
  const localBaseUrl = `${ollamaHost}/v1`;
  const localModel = config.model;
  const cloudModel =
    process.env.DAY29_CLOUD_MODEL?.trim() || modelRepo.getRole("chat")?.id || "openai/gpt-5-nano";
  const cloudJudgeModel =
    process.env.DAY29_CLOUD_JUDGE_MODEL?.trim() || modelRepo.getRole("judge")?.id || cloudModel;
  const cloudApiKey = getEnv("OPENAI_API_KEY");
  const cloudBaseUrl = (process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/$/, "");
  const cloudTimeoutMs = Number(process.env.DAY29_CLOUD_TIMEOUT_MS?.trim() || "180000");
  const runs = Number(process.env.DAY29_RUNS?.trim() || "2");
  const strategy = (process.env.DAY29_STRATEGY?.trim() || "structural") as "structural" | "fixed";
  const threshold = Number(process.env.DAY29_THRESHOLD?.trim() || "0.85");
  const questionsPath = process.env.DAY29_QUESTIONS_PATH?.trim() || "scripts/day22/control-questions.json";

  const allQuestions = JSON.parse(readFileSync(questionsPath, "utf8")) as OosQuestion[];
  const wanted = new Set(PART2_QUESTION_IDS);
  const questions = allQuestions.filter((q) => wanted.has(q.id));
  if (questions.length !== PART2_QUESTION_IDS.length) {
    fail(`Expected ${PART2_QUESTION_IDS.length} questions, got ${questions.length}`);
  }
  const oosIndex = new Map<string, OosQuestion>();
  for (const q of questions) {
    if (q.outOfScope) {
      if (!q.topicalTerms?.length) fail(`OOS question ${q.id} missing topicalTerms`);
      oosIndex.set(q.id, q);
    }
  }

  console.log(pc.bold(`Day 29 part2 — ${config.name}: ${config.description}`));
  console.log(pc.dim(`  model: ${localModel}`));
  console.log(pc.dim(`  temp: ${config.temperature}, max: ${config.maxCompletionTokens}`));
  console.log(pc.dim(`  gating threshold: ${config.gatingThreshold ?? "disabled"}`));
  console.log(pc.dim(`  questions: ${questions.map((q) => q.id).join(", ")}`));

  const localOpenAI = new OpenAI({ apiKey: "ollama", baseURL: localBaseUrl, maxRetries: 0 });
  const localLlmClient = new OpenAILLMClient(localOpenAI);
  const cloudOpenAI = new OpenAI({ apiKey: cloudApiKey, baseURL: cloudBaseUrl, timeout: cloudTimeoutMs, maxRetries: 0 });
  const cloudLlmClient = new OpenAILLMClient(cloudOpenAI);

  const embedder = new OllamaEmbedder({
    baseUrl: indexingConfig.embeddingBaseUrl,
    model: indexingConfig.embeddingModel,
    dimension: indexingConfig.embeddingDim,
  });
  const vectorIndex = new SqliteVectorIndex();

  const indexCount = vectorIndex.countByStrategy(strategy);
  if (indexCount === 0) fail(`Index for strategy=${strategy} is empty.`);

  console.log(pc.bold("\nPhase 0: fail-fast checks"));
  await pingOllama(ollamaHost, localModel);
  console.log(pc.green(`  ✓ Ollama ok, "${localModel}" available`));

  const vramBefore = captureVramSnapshot();
  console.log(pc.dim(`  VRAM before: ${vramBefore.gpuMemoryUsedMb}/${vramBefore.gpuMemoryTotalMb} MB`));

  console.log(pc.bold("\nPhase 2: warmup"));
  const warmStart = Date.now();
  await warmup(localLlmClient, localModel);
  console.log(pc.dim(`  warmup in ${formatLatency(Date.now() - warmStart)}`));
  const vramAfterWarmup = captureVramSnapshot();

  const reranker = new LlmRerankerService({ baseUrl: ollamaHost, model: localModel }, 0.3);
  const queryRewriter = new QueryRewriteService({ baseUrl: ollamaHost, model: localModel });
  const modes = buildModes(reranker, queryRewriter, strategy, threshold, config.gatingThreshold);

  const backends: BackendConfig[] = [
    { name: "local", llmClient: localLlmClient, modelId: localModel },
  ];

  const totalGens = questions.length * modes.length * backends.length * runs;
  console.log(pc.bold(`\nPhase 3: generation (${totalGens} runs)`));

  const service = new DualBackendEvalService(embedder, vectorIndex);
  const genStart = Date.now();
  const results = await service.run({
    questions: questions as ControlQuestion[],
    modes,
    backends,
    runs,
    temperature: config.temperature,
    maxCompletionTokens: config.maxCompletionTokens,
    observer: {
      onRunStart: (meta: RunMeta, progress: RunProgress) => {
        process.stdout.write(
          pc.dim(`  [${progress.index}/${progress.totalRuns}] ${meta.questionId} · ${meta.modeName} · run ${meta.runIndex} ... `),
        );
      },
      onRunDone: (run: AnswerRun) => {
        if (run.error) {
          process.stdout.write(pc.red(`ERR (${formatLatency(run.latencyMs)})\n`));
        } else if (run.skippedLLM) {
          process.stdout.write(pc.cyan(`SKIP-LLM (${formatLatency(run.latencyMs)}, ${run.refusalReason})\n`));
        } else {
          process.stdout.write(pc.dim(`ok ${formatLatency(run.latencyMs)}\n`));
        }
      },
    },
  });
  const genElapsed = Date.now() - genStart;
  const vramAfterGen = captureVramSnapshot();

  const skippedCount = results.filter((r) => r.skippedLLM).length;

  console.log(pc.bold("\nPhase 3 summary"));
  console.log(pc.dim(`  elapsed: ${formatLatency(genElapsed)}`));
  console.log(pc.dim(`  successful: ${results.filter((r) => !r.error).length}/${results.length}`));
  console.log(pc.dim(`  skipped-LLM: ${skippedCount}/${results.length}`));

  const refusalResults: Record<string, RefusalResult | null> = {};
  for (const run of results) {
    const key = `${run.questionId}|${run.modeName}|${run.runIndex}`;
    const oos = oosIndex.get(run.questionId);
    if (oos) {
      const rq: RefusalQuestion = { id: oos.id, topicalTerms: oos.topicalTerms ?? [] };
      refusalResults[key] = detectRefusal(run.answer, rq);
    } else {
      refusalResults[key] = null;
    }
  }
  const refusedCount = Object.values(refusalResults).filter((r) => r?.refused).length;
  const oosTotal = Object.values(refusalResults).filter((r) => r !== null).length;
  console.log(pc.dim(`  refusal (OOS): ${refusedCount}/${oosTotal}`));

  const cloudJudge = new RagJudgeService(cloudLlmClient, modelRepo);
  const localJudgeRepo = staticModelRepo(localModel);
  const localJudge = new RagJudgeService(localLlmClient, localJudgeRepo);
  const dualJudge = new DualJudgeService(cloudJudge, localJudge);

  console.log(pc.bold(`\nPhase 4: dual judge (${results.length * 2} calls)`));
  const judgeStart = Date.now();
  const judged = await dualJudge.judgeAll(results, questions as ControlQuestion[], {
    onJudgeStart: (meta, progress) => {
      process.stdout.write(
        pc.dim(`  [${progress.index}/${progress.total}] judge ${meta.questionId} · ${meta.modeName} · run ${meta.runIndex} ... `),
      );
    },
    onJudgeDone: (j) => {
      const c = j.cloudJudge ? `C=${j.cloudJudge.score}` : pc.red("C=ERR");
      const l = j.localJudge ? `L=${j.localJudge.score}` : pc.red("L=ERR");
      process.stdout.write(pc.dim(`${c} ${l}\n`));
    },
  });
  const judgeElapsed = Date.now() - judgeStart;

  const outputDir = "scripts/day29/part2-retrieval-gating/raw";
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  const outputPath = `${outputDir}/${config.name}.json`;

  const enriched = judged.map((j) => {
    const key = `${j.questionId}|${j.modeName}|${j.runIndex}`;
    return {
      ...j,
      refusal: refusalResults[key] ?? null,
    };
  });

  const artifact = {
    config: {
      name: config.name,
      description: config.description,
      model: config.model,
      temperature: config.temperature,
      maxCompletionTokens: config.maxCompletionTokens,
      gatingThreshold: config.gatingThreshold,
    },
    meta: {
      generatedAt: new Date().toISOString(),
      strategy,
      threshold,
      runs,
      questionIds: questions.map((q) => q.id),
      cloudJudgeModel,
      totalElapsedMs: Date.now() - genStart,
      genElapsedMs: genElapsed,
      judgeElapsedMs: judgeElapsed,
      skippedCount,
    },
    vram: {
      beforeWarmup: vramBefore,
      afterWarmup: vramAfterWarmup,
      afterGen: vramAfterGen,
    },
    runs: enriched,
  };

  writeFileSync(outputPath, JSON.stringify(artifact, null, 2), "utf8");
  console.log(pc.bold("\nPhase 5: artifact"));
  console.log(pc.green(`  ✓ saved: ${outputPath}`));
  console.log(pc.bold(`\nDone — part2 config ${config.name}`));
}

main().catch((error) => {
  console.error(pc.red("Day 29 part2 eval failed"));
  console.error(error instanceof Error ? error.message : String(error));
  if (error instanceof Error && error.stack) console.error(pc.dim(error.stack));
  process.exit(1);
});
