import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import OpenAI from "openai";
import pc from "picocolors";

import { loadConfig, applyDbOptions } from "../../src/config";
import { initDb } from "../../src/db";
import { SqliteSessionRepository } from "../../src/storage/sqlite/session-repository";
import { SqliteMessageRepository } from "../../src/storage/sqlite/message-repository";
import { SqliteFactRepository } from "../../src/storage/sqlite/fact-repository";
import { SqliteModelRepository } from "../../src/storage/sqlite/model-repository";
import { SqliteOptionsRepository } from "../../src/storage/sqlite/options-repository";
import { SqliteProfileRepository } from "../../src/storage/sqlite/profile-repository";
import { SqliteTaskStateRepository } from "../../src/storage/sqlite/task-state-repository";
import { SqliteVectorIndex } from "../../src/storage/sqlite/sqlite-vector-index";
import { OpenAILLMClient } from "../../src/api/openai/llm-client";
import { OllamaEmbedder } from "../../src/api/ollama/ollama-embedder";
import { SessionService } from "../../src/domain/services/session-service";
import { ContextService } from "../../src/domain/services/context-service";
import { CostService } from "../../src/domain/services/cost-service";
import { ChatService } from "../../src/domain/services/chat-service";
import { ProfileService } from "../../src/domain/services/profile-service";
import { RagPipelineService, type RagMode } from "../../src/domain/services/rag-pipeline-service";
import { FaithfulnessJudge, type FaithfulnessScore } from "../../src/domain/services/faithfulness-judge";
import { TaskStateService } from "../../src/domain/services/task-state-service";
import { buildCitedRagPromptSuffix } from "../../src/domain/services/rag-service";
import { readIndexingConfig } from "../../src/indexing-config";
import type { CitedRagResponse } from "../../src/domain/models/cited-rag-response";
import { citedRagResponseToOpenAISchema, parseCitedRagResponse } from "../../src/domain/models/cited-rag-response";
import type { ResponseFormat } from "../../src/domain/models";
import type { TaskState } from "../../src/domain/models/task-state";
import { createEmptyTaskState } from "../../src/domain/models/task-state";

type Scenario = {
  id: string;
  title: string;
  description: string;
  expectedGoalKeywords: string[];
  expectedConstraintKeywords: string[];
  expectedTermKeys: string[];
  messages: string[];
};

type StepResult = {
  step: number;
  userMessage: string;
  ragStatus: string;
  hitsCount: number;
  cited: CitedRagResponse | null;
  rawAnswer: string;
  answerCostUsd: number;
  answerInputTokens: number;
  answerOutputTokens: number;
  taskStateSnapshot: TaskState;
  reconcileChanged: boolean;
  reconcileInputTokens: number;
  reconcileOutputTokens: number;
  reconcileError?: string;
  faithfulness: FaithfulnessScore | null;
};

type ScenarioResult = {
  scenario: Scenario;
  steps: StepResult[];
  finalState: TaskState;
  goalPreserved: boolean;
  constraintsPreserved: boolean;
  termsPreserved: boolean;
  sourcesPresentCount: number;
  avgFaithfulness: number | null;
  confidenceDistribution: Record<string, number>;
  totalAnswerCost: number;
  totalReconcileTokens: number;
};

function fail(message: string): never {
  console.error(pc.red(message));
  process.exit(1);
}

function loadScenarios(dir: string): Scenario[] {
  const entries = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  return entries.map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Scenario);
}

function containsAny(haystack: string, needles: string[]): boolean {
  const lower = haystack.toLowerCase();
  return needles.some((n) => lower.includes(n.toLowerCase()));
}

async function runScenario(
  scenario: Scenario,
  deps: {
    config: ReturnType<typeof loadConfig>;
    sessionService: SessionService;
    chatService: ChatService;
    taskStateService: TaskStateService;
    pipeline: RagPipelineService;
    faithfulnessJudge: FaithfulnessJudge;
    modelRepo: SqliteModelRepository;
    costService: CostService;
  },
): Promise<ScenarioResult> {
  const { config, sessionService, chatService, taskStateService, pipeline, faithfulnessJudge } = deps;

  console.log(pc.bold(pc.cyan(`\n=== Scenario: ${scenario.id} — ${scenario.title} ===`)));

  const sessionId = sessionService.createSession(scenario.title, "full");
  const steps: StepResult[] = [];
  let totalAnswerCost = 0;
  let totalReconcileInput = 0;
  let totalReconcileOutput = 0;
  const confidenceDistribution: Record<string, number> = { high: 0, low: 0, insufficient: 0, unparsed: 0 };

  for (let i = 0; i < scenario.messages.length; i++) {
    const userMessage = scenario.messages[i];
    const stepNum = i + 1;
    process.stdout.write(pc.dim(`  step ${stepNum}/${scenario.messages.length}... `));

    const retrieval = await pipeline.retrieve(userMessage);

    let cited: CitedRagResponse | null = null;
    let rawAnswer = "";
    let answerCost = 0;
    let answerInputTokens = 0;
    let answerOutputTokens = 0;

    if (retrieval.status === "ok" && retrieval.hits.length > 0) {
      const promptSuffix = buildCitedRagPromptSuffix(retrieval.hits);

      const currentState = taskStateService.getState(sessionId);
      const stateBlock = taskStateService.formatForPrompt(currentState);
      const systemPrompt = stateBlock
        ? `${stateBlock}\n\n${config.systemPrompt}`
        : config.systemPrompt;

      const responseFormat = citedRagResponseToOpenAISchema() as ResponseFormat;

      const result = await chatService.sendMessage(sessionId, userMessage, {
        historyLimit: config.historyLimit,
        systemPrompt,
        useStreaming: false,
        userPromptSuffix: promptSuffix,
        responseFormat,
        temperature: config.temperature,
        topP: config.topP,
        maxCompletionTokens: config.maxCompletionTokens,
        reasoningEffort: config.reasoningEffort,
        reasoningSummary: config.reasoningSummary,
      });

      rawAnswer = result.response.content;
      cited = parseCitedRagResponse(rawAnswer);
      if (result.costInfo) {
        answerCost = result.costInfo.cost;
        answerInputTokens = result.costInfo.inputTokens;
        answerOutputTokens = result.costInfo.outputTokens;
        totalAnswerCost += result.costInfo.cost;
      }
    } else {
      const fallbackAnswer = "К сожалению, в доступной базе знаний нет информации для ответа на этот вопрос. Попробуйте переформулировать запрос или уточнить тему.";
      rawAnswer = fallbackAnswer;
      cited = {
        answer: fallbackAnswer,
        confidence: "insufficient",
        sources: [],
        quotes: [],
      };
      sessionService.addMessage(sessionId, "user", userMessage);
      sessionService.addMessage(sessionId, "assistant", fallbackAnswer);
    }

    const confidence = cited?.confidence ?? "unparsed";
    confidenceDistribution[confidence] = (confidenceDistribution[confidence] ?? 0) + 1;

    const answerForReconcile = cited?.answer ?? rawAnswer;
    const reconcileResult = await taskStateService.reconcile(sessionId, userMessage, answerForReconcile);
    totalReconcileInput += reconcileResult.inputTokens;
    totalReconcileOutput += reconcileResult.outputTokens;

    const snapshot = taskStateService.getState(sessionId);

    let faithfulness: FaithfulnessScore | null = null;
    if (cited && cited.confidence !== "insufficient" && cited.quotes.length > 0) {
      faithfulness = await faithfulnessJudge.judge(cited);
    }

    steps.push({
      step: stepNum,
      userMessage,
      ragStatus: retrieval.status,
      hitsCount: retrieval.hits.length,
      cited,
      rawAnswer,
      answerCostUsd: answerCost,
      answerInputTokens,
      answerOutputTokens,
      taskStateSnapshot: snapshot,
      reconcileChanged: reconcileResult.changed,
      reconcileInputTokens: reconcileResult.inputTokens,
      reconcileOutputTokens: reconcileResult.outputTokens,
      reconcileError: reconcileResult.error,
      faithfulness,
    });

    const srcMark = cited && cited.sources.length > 0 ? pc.green("src✓") : pc.red("src✗");
    const confMark = confidence === "high" ? pc.green(confidence) : confidence === "low" ? pc.yellow(confidence) : pc.dim(confidence);
    console.log(`${srcMark} ${confMark} state-changed=${reconcileResult.changed}`);
  }

  const finalState = taskStateService.getState(sessionId);

  const goalPreserved = finalState.goal
    ? containsAny(finalState.goal, scenario.expectedGoalKeywords)
    : false;

  const constraintsPreserved = scenario.expectedConstraintKeywords.length === 0
    || scenario.expectedConstraintKeywords.every((kw) =>
      finalState.constraints.some((c) => c.toLowerCase().includes(kw.toLowerCase())),
    );

  const termsPreserved = scenario.expectedTermKeys.length === 0
    || scenario.expectedTermKeys.every((k) =>
      Object.keys(finalState.terms).some((tk) => tk.toLowerCase().includes(k.toLowerCase())),
    );

  const sourcesPresentCount = steps.filter((s) => s.cited && s.cited.sources.length > 0).length;
  const faithfulnessScores = steps
    .map((s) => s.faithfulness)
    .filter((f): f is FaithfulnessScore => f !== null)
    .map((f) => f.score);
  const avgFaithfulness = faithfulnessScores.length > 0
    ? faithfulnessScores.reduce((a, b) => a + b, 0) / faithfulnessScores.length
    : null;

  return {
    scenario,
    steps,
    finalState,
    goalPreserved,
    constraintsPreserved,
    termsPreserved,
    sourcesPresentCount,
    avgFaithfulness,
    confidenceDistribution,
    totalAnswerCost,
    totalReconcileTokens: totalReconcileInput + totalReconcileOutput,
  };
}

function escapeMd(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function renderReport(results: ScenarioResult[]): string {
  const lines: string[] = [];
  lines.push("# Day 25 — Mini-chat with RAG & task memory report");
  lines.push("");
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push("| Scenario | Steps | Sources rate | Goal | Constraints | Terms | Avg faithfulness | Confidence (h/l/i) | Answer cost | Reconcile tokens |");
  lines.push("|----------|-------|--------------|------|-------------|-------|-------------------|---------------------|-------------|------------------|");
  for (const r of results) {
    const srcRate = r.steps.length > 0
      ? `${r.sourcesPresentCount}/${r.steps.length}`
      : "0/0";
    const goal = r.goalPreserved ? "✓" : "✗";
    const cons = r.constraintsPreserved ? "✓" : "✗";
    const terms = r.termsPreserved ? "✓" : "✗";
    const faith = r.avgFaithfulness !== null ? r.avgFaithfulness.toFixed(2) : "—";
    const cd = r.confidenceDistribution;
    const confStr = `${cd.high ?? 0}/${cd.low ?? 0}/${(cd.insufficient ?? 0) + (cd.unparsed ?? 0)}`;
    const costStr = `$${r.totalAnswerCost.toFixed(6)}`;
    lines.push(
      `| ${r.scenario.id} | ${r.steps.length} | ${srcRate} | ${goal} | ${cons} | ${terms} | ${faith} | ${confStr} | ${costStr} | ${r.totalReconcileTokens} |`,
    );
  }
  lines.push("");

  for (const r of results) {
    lines.push(`## ${r.scenario.id}: ${r.scenario.title}`);
    lines.push("");
    lines.push(`**Описание:** ${r.scenario.description}`);
    lines.push("");
    lines.push(`**Ожидаемая цель содержит:** ${r.scenario.expectedGoalKeywords.join(", ")}`);
    lines.push(`**Ожидаемые ограничения:** ${r.scenario.expectedConstraintKeywords.join(", ")}`);
    lines.push(`**Ожидаемые ключи терминов:** ${r.scenario.expectedTermKeys.join(", ")}`);
    lines.push("");

    lines.push("### Финальное состояние задачи");
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(r.finalState, null, 2));
    lines.push("```");
    lines.push("");

    lines.push("### Проверки");
    lines.push("");
    lines.push(`- Goal preservation: ${r.goalPreserved ? "✓" : "✗"} (финальная goal: ${JSON.stringify(r.finalState.goal)})`);
    lines.push(`- Constraint retention: ${r.constraintsPreserved ? "✓" : "✗"} (финальные: ${JSON.stringify(r.finalState.constraints)})`);
    lines.push(`- Term retention: ${r.termsPreserved ? "✓" : "✗"} (финальные ключи: ${JSON.stringify(Object.keys(r.finalState.terms))})`);
    lines.push(`- Sources present on steps: ${r.sourcesPresentCount}/${r.steps.length}`);
    lines.push(`- Avg faithfulness: ${r.avgFaithfulness !== null ? r.avgFaithfulness.toFixed(2) + "/3" : "—"}`);
    lines.push("");

    lines.push("### Per-step");
    lines.push("");
    lines.push("| # | Sources | Conf. | Faith. | Reconcile | Cost (step) | User |");
    lines.push("|---|---------|-------|--------|-----------|-------------|------|");
    for (const s of r.steps) {
      const src = s.cited && s.cited.sources.length > 0 ? `${s.cited.sources.length}` : "0";
      const conf = s.cited?.confidence ?? "unparsed";
      const faith = s.faithfulness ? `${s.faithfulness.score}/3` : "—";
      const rec = s.reconcileChanged ? "changed" : "same";
      const cost = `$${s.answerCostUsd.toFixed(6)}`;
      const shortMsg = s.userMessage.length > 80 ? s.userMessage.slice(0, 80) + "…" : s.userMessage;
      lines.push(`| ${s.step} | ${src} | ${conf} | ${faith} | ${rec} | ${cost} | ${escapeMd(shortMsg)} |`);
    }
    lines.push("");

    lines.push("### Детали по шагам");
    lines.push("");
    for (const s of r.steps) {
      lines.push(`#### Шаг ${s.step}`);
      lines.push("");
      lines.push(`**User:** ${s.userMessage}`);
      lines.push("");
      lines.push(`**Retrieval:** ${s.ragStatus} (${s.hitsCount} hits)`);
      lines.push(`**Confidence:** ${s.cited?.confidence ?? "unparsed"}`);
      lines.push(`**Sources:** ${s.cited?.sources.length ?? 0} | **Quotes:** ${s.cited?.quotes.length ?? 0}`);
      if (s.faithfulness) {
        lines.push(`**Faithfulness:** ${s.faithfulness.score}/3 — ${s.faithfulness.verdict}`);
      }
      lines.push(`**Reconcile:** changed=${s.reconcileChanged}${s.reconcileError ? ` error=${s.reconcileError}` : ""}`);
      lines.push(`**Answer cost:** $${s.answerCostUsd.toFixed(6)} (${s.answerInputTokens} in / ${s.answerOutputTokens} out)`);
      lines.push("");
      lines.push(`**Answer:**`);
      lines.push("");
      const answerPreview = (s.cited?.answer ?? s.rawAnswer).slice(0, 600);
      lines.push(answerPreview);
      lines.push("");
      if (s.cited && s.cited.sources.length > 0) {
        lines.push(`**Sources used:**`);
        for (const src of s.cited.sources) {
          lines.push(`- [${src.sourceIndex}] ${src.source}${src.section ? " > " + src.section : ""}`);
        }
        lines.push("");
      }
      lines.push(`**Task state after step:**`);
      lines.push("```json");
      lines.push(JSON.stringify(s.taskStateSnapshot, null, 2));
      lines.push("```");
      lines.push("");
    }
  }

  return lines.join("\n");
}

async function main(): Promise<void> {
  const scenariosDir = join(__dirname, "scenarios");
  const reportPath = join(__dirname, "report.md");

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
  const taskStateRepo = new SqliteTaskStateRepository();

  const sessionService = new SessionService(sessionRepo, messageRepo);
  const contextService = new ContextService();
  const costService = new CostService(modelRepo);
  const profileService = new ProfileService(profileRepo, optionsRepo);
  const llmClient = new OpenAILLMClient(openaiClient);
  const chatService = new ChatService(
    llmClient, sessionService, contextService, costService,
    messageRepo, factRepo, modelRepo, profileService,
  );

  const indexingConfig = readIndexingConfig(optionsRepo);
  const vectorIndex = new SqliteVectorIndex();
  const embedder = new OllamaEmbedder({
    baseUrl: indexingConfig.embeddingBaseUrl,
    model: indexingConfig.embeddingModel,
    dimension: indexingConfig.embeddingDim,
  });

  const ragStrategy = (optionsRepo.get("rag_strategy") ?? "structural") as "fixed" | "structural";
  if (vectorIndex.countByStrategy(ragStrategy) === 0) {
    fail(`Index for strategy ${ragStrategy} is empty. Run indexing first (bun run indexing).`);
  }

  const mode: RagMode = {
    name: "day25-chat",
    strategy: ragStrategy,
    topKInitial: 5,
    topKFinal: 5,
    useCitations: true,
  };

  const pipeline = new RagPipelineService(embedder, vectorIndex, mode);
  const faithfulnessJudge = new FaithfulnessJudge(llmClient, modelRepo);
  const taskStateService = new TaskStateService(taskStateRepo, llmClient, modelRepo);

  const scenarios = loadScenarios(scenariosDir);
  if (scenarios.length === 0) fail(`No scenarios found in ${scenariosDir}`);

  console.log(pc.bold(`Day 25 scenario run — ${scenarios.length} scenarios, strategy=${ragStrategy}`));

  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    const r = await runScenario(scenario, {
      config,
      sessionService,
      chatService,
      taskStateService,
      pipeline,
      faithfulnessJudge,
      modelRepo,
      costService,
    });
    results.push(r);
  }

  const report = renderReport(results);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, report, "utf8");
  console.log(pc.green(`\n✔ Report saved: ${reportPath}`));
}

main().catch((e) => {
  console.error(pc.red(`Fatal: ${e instanceof Error ? e.message : String(e)}`));
  process.exit(1);
});
