import { readFileSync, writeFileSync } from "node:fs";
import OpenAI from "openai";
import pc from "picocolors";

import { loadConfig, applyDbOptions } from "./config";
import { initDb } from "./db";
import { SqliteSessionRepository } from "./storage/sqlite/session-repository";
import { SqliteMessageRepository } from "./storage/sqlite/message-repository";
import { SqliteFactRepository } from "./storage/sqlite/fact-repository";
import { SqliteModelRepository } from "./storage/sqlite/model-repository";
import { SqliteOptionsRepository } from "./storage/sqlite/options-repository";
import { SqliteProfileRepository } from "./storage/sqlite/profile-repository";
import { OpenAILLMClient } from "./api/openai/llm-client";
import { OllamaEmbedder } from "./api/ollama/ollama-embedder";
import { SessionService } from "./domain/services/session-service";
import { ContextService } from "./domain/services/context-service";
import { CostService } from "./domain/services/cost-service";
import { ChatService } from "./domain/services/chat-service";
import { ProfileService } from "./domain/services/profile-service";
import { RagPipelineService, type RagMode, type PipelineRetrieveResult } from "./domain/services/rag-pipeline-service";
import { RagJudgeService } from "./domain/services/rag-judge-service";
import { scoreAnswer, type RulesScore } from "./domain/services/rag-rules-scorer";
import { renderMultiModeReport, type MultiModeQuestionResult, type ModeResult } from "./domain/services/rag-multimode-report";
import { SqliteVectorIndex } from "./storage/sqlite/sqlite-vector-index";
import { readIndexingConfig } from "./indexing-config";
import type { ControlQuestion, AnswerRunResult } from "./domain/services/rag-evaluation-service";
import type { JudgeScore } from "./domain/services/rag-judge-service";

function fail(message: string): never {
  console.error(pc.red(message));
  process.exit(1);
}

function parseArgs(argv: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      const next = argv[i + 1];
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

  return { positional, flags };
}

function startSpinner(message: string): () => void {
  const frames = ["\u28CB", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];
  let index = 0;
  process.stdout.write(pc.dim(`${frames[0]} ${message}`));
  const interval = setInterval(() => {
    index = (index + 1) % frames.length;
    process.stdout.write(`\r${pc.dim(`${frames[index]} ${message}`)}`);
  }, 80);

  return () => {
    clearInterval(interval);
    process.stdout.write(`\r${" ".repeat(message.length + 4)}\r`);
  };
}

async function withSpinner<T>(message: string, task: () => Promise<T>): Promise<T> {
  const stop = startSpinner(message);
  try {
    return await task();
  } finally {
    stop();
  }
}

async function main(): Promise<void> {
  const { positional, flags } = parseArgs(Bun.argv.slice(2));
  const questionsPath = positional[0] ?? "scripts/day22/control-questions.json";
  const reportPath = flags.report ?? "scripts/day23/report.md";
  const thresholdStr = flags.threshold ?? "0.85";
  const threshold = parseFloat(thresholdStr);

  const config = loadConfig([], fail);
  initDb(config.historyDb);

  const optionsRepo = new SqliteOptionsRepository();
  applyDbOptions(config, (key) => optionsRepo.get(key));

  const openaiClient = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    timeout: config.effectiveTimeoutMs,
    maxRetries: 0,
  });

  const sessionRepo = new SqliteSessionRepository();
  const messageRepo = new SqliteMessageRepository();
  const factRepo = new SqliteFactRepository();
  const modelRepo = new SqliteModelRepository();
  const profileRepo = new SqliteProfileRepository();
  const sessionService = new SessionService(sessionRepo, messageRepo);
  const contextService = new ContextService();
  const costService = new CostService(modelRepo);
  const profileService = new ProfileService(profileRepo, optionsRepo);
  const llmClient = new OpenAILLMClient(openaiClient);
  const chatService = new ChatService(
    llmClient,
    sessionService,
    contextService,
    costService,
    messageRepo,
    factRepo,
    modelRepo,
    profileService,
  );

  const indexingConfig = readIndexingConfig(optionsRepo);
  const vectorIndex = new SqliteVectorIndex();
  const embedder = new OllamaEmbedder({
    baseUrl: indexingConfig.embeddingBaseUrl,
    model: indexingConfig.embeddingModel,
    dimension: indexingConfig.embeddingDim,
  });
  const judgeService = new RagJudgeService(llmClient, modelRepo);

  const ragStrategy = (flags.strategy ?? optionsRepo.get("rag_strategy") ?? "structural") as "fixed" | "structural";
  if (vectorIndex.countByStrategy(ragStrategy) === 0) {
    fail(
      `Index for strategy ${ragStrategy} is empty. Index a document first, e.g.:\n` +
      `  bun run indexing index scripts/day21/data/system-design-primer.md --strategy ${ragStrategy}`,
    );
  }

  const raw = readFileSync(questionsPath, "utf8");
  const questions = JSON.parse(raw) as ControlQuestion[];
  if (!Array.isArray(questions) || questions.length === 0) {
    fail(`${questionsPath} must contain a non-empty array of control questions`);
  }

  const answerQuestion = async (question: string, options?: { userPromptSuffix?: string }): Promise<AnswerRunResult> => {
    const sessionId = sessionService.createSession(undefined, "full");
    try {
      const result = await chatService.sendMessage(sessionId, question, {
        historyLimit: config.historyLimit,
        systemPrompt: config.systemPrompt,
        useStreaming: false,
        userPromptSuffix: options?.userPromptSuffix,
        temperature: config.temperature,
        topP: config.topP,
        maxCompletionTokens: config.maxCompletionTokens,
        reasoningEffort: config.reasoningEffort,
        reasoningSummary: config.reasoningSummary,
      });
      return {
        answer: result.response.content,
        costInfo: result.costInfo,
      };
    } finally {
      sessionService.deleteSession(sessionId);
    }
  };

  const modes: RagMode[] = [
    {
      name: "rag-plain",
      strategy: ragStrategy,
      topKInitial: 3,
      topKFinal: 3,
    },
    {
      name: "rag-threshold",
      strategy: ragStrategy,
      topKInitial: 10,
      topKFinal: 3,
      threshold,
    },
  ];

  console.log(pc.bold(`Day 23 pipeline evaluation on ${questions.length} questions`));
  console.log(pc.dim(`  strategy: ${ragStrategy}`));
  console.log(pc.dim(`  threshold: ${threshold}`));
  console.log(pc.dim(`  modes: ${modes.map((m) => m.name).join(", ")}`));

  const results: MultiModeQuestionResult[] = [];

  for (const question of questions) {
    console.log(pc.cyan(`\n[${question.id}] ${question.question}`));

    const baseline = await withSpinner(`Baseline (${question.id})`, async () => {
      return answerQuestion(question.question);
    });
    console.log(pc.dim(`  baseline cost: ${formatCost(baseline.costInfo)}`));

    const modeResults: ModeResult[] = [];

    for (const mode of modes) {
      const pipeline = new RagPipelineService(embedder, vectorIndex, mode);

      const retrieval = await withSpinner(`${mode.name} retrieval (${question.id})`, async () => {
        return pipeline.retrieve(question.question);
      });

      const ragAnswer = await withSpinner(`${mode.name} answer (${question.id})`, async () => {
        return answerQuestion(question.question, {
          userPromptSuffix: retrieval.status === "ok" ? retrieval.promptSuffix : undefined,
        });
      });

      console.log(pc.dim(`  ${mode.name} cost: ${formatCost(ragAnswer.costInfo)} | retrieval=${retrieval.status} (${retrieval.hitsBeforeFilter}→${retrieval.hits.length})`));

      const rules = scoreAnswer(question, ragAnswer.answer, retrieval);

      modeResults.push({
        modeName: mode.name,
        answer: ragAnswer.answer,
        costInfo: ragAnswer.costInfo,
        rules,
        judge: { score: 0, verdict: "", modelId: "", raw: "" },
        retrieval,
      });
    }

    const baselineRules = scoreAnswer(question, baseline.answer);

    results.push({
      question,
      baseline: {
        modeName: "baseline",
        answer: baseline.answer,
        costInfo: baseline.costInfo,
        rules: baselineRules,
        judge: { score: 0, verdict: "", modelId: "", raw: "" },
      },
      modes: modeResults,
    });
  }

  console.log(pc.dim("\nJudge scoring..."));

  for (const result of results) {
    const baselineJudge = await withSpinner(`Judge baseline (${result.question.id})`, async () => {
      return judgeService.judge(result.question, result.baseline.answer);
    });
    result.baseline.judge = baselineJudge;

    for (const mode of result.modes) {
      const modeJudge = await withSpinner(`Judge ${mode.modeName} (${result.question.id})`, async () => {
        return judgeService.judge(result.question, mode.answer, mode.retrieval);
      });
      mode.judge = modeJudge;
    }
  }

  const report = renderMultiModeReport(results, {
    strategy: ragStrategy,
    generatedAt: new Date().toISOString(),
  });
  writeFileSync(reportPath, report, "utf8");

  console.log();
  console.log(pc.green(`\u2714 Report saved: ${reportPath}`));
}

function formatCost(costInfo: { cost: number; inputTokens: number; outputTokens: number } | null): string {
  if (!costInfo) return "\u2014";
  const amount = costInfo.cost < 0.01 ? costInfo.cost.toFixed(6) : costInfo.cost.toFixed(4);
  return `$${amount} (${costInfo.inputTokens}/${costInfo.outputTokens})`;
}

main().catch((error) => {
  console.error(pc.red("RAG pipeline evaluation failed"));
  console.error(error instanceof Error ? error.message : String(error));
  if (error instanceof Error && error.stack) {
    console.error(pc.dim(error.stack));
  }
  process.exit(1);
});
