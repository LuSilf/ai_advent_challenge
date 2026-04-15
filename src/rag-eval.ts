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
import { RagService } from "./domain/services/rag-service";
import { RagEvaluationService, type AnswerRunResult, type ControlQuestion } from "./domain/services/rag-evaluation-service";
import { RagJudgeService } from "./domain/services/rag-judge-service";
import { attachJudgeScores } from "./domain/services/rag-judge-scorer";
import { attachRuleScores } from "./domain/services/rag-rules-scorer";
import { renderRagEvaluationReport } from "./domain/services/rag-evaluation-report";
import { SqliteVectorIndex } from "./storage/sqlite/sqlite-vector-index";
import { readIndexingConfig } from "./indexing-config";

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

function parseRagStrategy(raw: string | null): "fixed" | "structural" {
  return raw === "fixed" ? "fixed" : "structural";
}

function parseTopK(raw: string | null, fallback = 5): number {
  const parsed = Number(raw ?? String(fallback));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function startSpinner(message: string): () => void {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
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
  const reportPath = flags.report ?? "scripts/day22/report.md";

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
  const ragService = new RagService(embedder, vectorIndex);
  const judgeService = new RagJudgeService(llmClient, modelRepo);

  const ragStrategy = parseRagStrategy(flags.strategy ?? optionsRepo.get("rag_strategy"));
  const ragTopK = parseTopK(flags.topk ?? null, 3);
  if (vectorIndex.countByStrategy(ragStrategy) === 0) {
    fail(
      `Индекс для стратегии ${ragStrategy} пуст. Сначала проиндексируйте документ, например:\n` +
      `  bun run indexing index scripts/day21/data/system-design-primer.md --strategy ${ragStrategy}`,
    );
  }

  const raw = readFileSync(questionsPath, "utf8");
  const questions = JSON.parse(raw) as ControlQuestion[];
  if (!Array.isArray(questions) || questions.length === 0) {
    fail(`${questionsPath} должен содержать непустой массив контрольных вопросов`);
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

  const evaluationService = new RagEvaluationService(answerQuestion, ragService);

  console.log(pc.bold(`Day 22 evaluation on ${questions.length} questions`));
  console.log(pc.dim(`  rag strategy: ${ragStrategy}`));
  console.log(pc.dim(`  rag topK: ${ragTopK}`));

  const results = [];
  for (const question of questions) {
    console.log(pc.cyan(`\n[${question.id}] ${question.question}`));
    const [evaluated] = await withSpinner(`Baseline → retrieval → RAG (${question.id})`, async () => {
      return evaluationService.evaluate([question], {
        strategy: ragStrategy,
        topK: ragTopK,
      }).then((items) => [items[0]!]);
    });
    results.push(evaluated);
    console.log(pc.dim(`  baseline cost: ${formatCost(evaluated.baseline.costInfo)}`));
    console.log(pc.dim(`  rag cost: ${formatCost(evaluated.rag.costInfo)} | retrieval=${evaluated.rag.retrieval.status}`));
  }

  const ruleScoredResults = attachRuleScores(results);
  const judgeScoredResults = await withSpinner(`Judge scoring ${ruleScoredResults.length} question(s)`, async () => {
    return attachJudgeScores(ruleScoredResults, judgeService);
  });

  const report = renderRagEvaluationReport(judgeScoredResults, {
    strategy: ragStrategy,
    topK: ragTopK,
    generatedAt: new Date().toISOString(),
  });
  writeFileSync(reportPath, report, "utf8");

  console.log();
  console.log(pc.green(`✔ Report saved: ${reportPath}`));
}

function formatCost(costInfo: { cost: number; inputTokens: number; outputTokens: number } | null): string {
  if (!costInfo) return "—";
  const amount = costInfo.cost < 0.01 ? costInfo.cost.toFixed(6) : costInfo.cost.toFixed(4);
  return `$${amount} (${costInfo.inputTokens}/${costInfo.outputTokens})`;
}

main().catch((error) => {
  console.error(pc.red("RAG evaluation failed"));
  console.error(error instanceof Error ? error.message : String(error));
  if (error instanceof Error && error.stack) {
    console.error(pc.dim(error.stack));
  }
  process.exit(1);
});
