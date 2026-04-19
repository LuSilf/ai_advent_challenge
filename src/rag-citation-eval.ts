import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
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
import { LlmRerankerService } from "./domain/services/llm-reranker-service";
import { QueryRewriteService } from "./domain/services/query-rewrite-service";
import { RagJudgeService } from "./domain/services/rag-judge-service";
import { FaithfulnessJudge, type FaithfulnessScore } from "./domain/services/faithfulness-judge";
import { scoreAnswer, type RulesScore } from "./domain/services/rag-rules-scorer";
import { scoreCitation, type CitationScore } from "./domain/services/citation-scorer";
import { SqliteVectorIndex } from "./storage/sqlite/sqlite-vector-index";
import { readIndexingConfig } from "./indexing-config";
import type { ControlQuestion, AnswerRunResult } from "./domain/services/rag-evaluation-service";
import type { JudgeScore } from "./domain/services/rag-judge-service";
import type { CostInfo, ResponseFormat } from "./domain/models";
import { citedRagResponseToOpenAISchema, parseCitedRagResponse, type CitedRagResponse } from "./domain/models/cited-rag-response";
import { buildCitedRagPromptSuffix } from "./domain/services/rag-service";

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

type CitedAnswerResult = {
  answer: string;
  cited: CitedRagResponse | null;
  costInfo: CostInfo | null;
};

type QuestionResult = {
  question: ControlQuestion;
  retrieval: PipelineRetrieveResult;
  cited: CitedAnswerResult;
  rules: RulesScore;
  judge: JudgeScore;
  citation: CitationScore;
  faithfulness: FaithfulnessScore | null;
};

async function main(): Promise<void> {
  const { positional, flags } = parseArgs(Bun.argv.slice(2));
  const questionsPath = positional[0] ?? "scripts/day22/control-questions.json";
  const reportPath = flags.report ?? "scripts/day24/report.md";
  const threshold = parseFloat(flags.threshold ?? "0.85");

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
  const judgeService = new RagJudgeService(llmClient, modelRepo);
  const faithfulnessJudge = new FaithfulnessJudge(llmClient, modelRepo);

  const ragStrategy = (flags.strategy ?? optionsRepo.get("rag_strategy") ?? "structural") as "fixed" | "structural";
  if (vectorIndex.countByStrategy(ragStrategy) === 0) {
    fail(`Index for strategy ${ragStrategy} is empty.`);
  }

  const raw = readFileSync(questionsPath, "utf8");
  const questions = JSON.parse(raw) as ControlQuestion[];
  if (!Array.isArray(questions) || questions.length === 0) {
    fail(`${questionsPath} must contain a non-empty array`);
  }

  const ollamaBaseUrl = indexingConfig.embeddingBaseUrl;
  const rerankerModel = flags["reranker-model"] ?? "qwen2.5-coder:3b";

  const mode: RagMode = {
    name: "rag-full-cited",
    strategy: ragStrategy,
    topKInitial: 10,
    topKFinal: 3,
    threshold,
    reranker: new LlmRerankerService({ baseUrl: ollamaBaseUrl, model: rerankerModel }, 0.3),
    queryRewriter: new QueryRewriteService({ baseUrl: ollamaBaseUrl, model: rerankerModel }),
    useCitations: true,
  };

  const responseFormat = citedRagResponseToOpenAISchema() as ResponseFormat;

  const answerWithCitations = async (
    question: string,
    promptSuffix: string,
  ): Promise<CitedAnswerResult> => {
    const sessionId = sessionService.createSession(undefined, "full");
    try {
      const result = await chatService.sendMessage(sessionId, question, {
        historyLimit: config.historyLimit,
        systemPrompt: config.systemPrompt,
        useStreaming: false,
        userPromptSuffix: promptSuffix,
        responseFormat,
        temperature: config.temperature,
        topP: config.topP,
        maxCompletionTokens: config.maxCompletionTokens,
        reasoningEffort: config.reasoningEffort,
        reasoningSummary: config.reasoningSummary,
      });
      const cited = parseCitedRagResponse(result.response.content);
      return {
        answer: cited?.answer ?? result.response.content,
        cited,
        costInfo: result.costInfo,
      };
    } finally {
      sessionService.deleteSession(sessionId);
    }
  };

  const inScopeQuestions = questions.filter((q) => !q.outOfScope);
  const outOfScopeQuestions = questions.filter((q) => q.outOfScope);

  console.log(pc.bold(`Day 24 citation evaluation on ${questions.length} questions (${inScopeQuestions.length} in-scope, ${outOfScopeQuestions.length} out-of-scope)`));
  console.log(pc.dim(`  strategy: ${ragStrategy}, threshold: ${threshold}, reranker: ${rerankerModel}`));

  const results: QuestionResult[] = [];

  for (const question of questions) {
    console.log(pc.cyan(`\n[${question.id}] ${question.question}`));

    const pipeline = new RagPipelineService(embedder, vectorIndex, mode);
    const retrieval = await withSpinner(`retrieval (${question.id})`, () =>
      pipeline.retrieve(question.question),
    );

    console.log(pc.dim(`  retrieval: ${retrieval.status} (${retrieval.hitsBeforeFilter}→${retrieval.hits.length})`));

    let cited: CitedAnswerResult;

    if (retrieval.status === "insufficient_context" || retrieval.status === "no_hits" || retrieval.status === "no_index") {
      cited = {
        answer: "К сожалению, в доступной базе знаний нет информации для ответа на этот вопрос. Попробуйте переформулировать запрос или уточнить тему.",
        cited: {
          answer: "К сожалению, в доступной базе знаний нет информации для ответа на этот вопрос. Попробуйте переформулировать запрос или уточнить тему.",
          confidence: "insufficient",
          sources: [],
          quotes: [],
        },
        costInfo: { cost: 0, inputTokens: 0, outputTokens: 0 },
      };
      console.log(pc.yellow(`  skipped LLM call (${retrieval.status})`));
    } else {
      const promptSuffix = buildCitedRagPromptSuffix(retrieval.hits);
      cited = await withSpinner(`answer (${question.id})`, () =>
        answerWithCitations(question.question, promptSuffix),
      );
      if (!cited.cited) {
        console.log(pc.red(`  WARNING: failed to parse structured response`));
      }
    }

    const citationScore = scoreCitation(cited.cited, question.outOfScope ?? false);

    console.log(pc.dim(`  sources: ${citationScore.sourceCount}, quotes: ${citationScore.quoteCount}, confidence: ${citationScore.confidence}`));
    if (citationScore.isInsufficientCorrect !== undefined) {
      console.log(citationScore.isInsufficientCorrect
        ? pc.green(`  ✓ correctly identified as out-of-scope`)
        : pc.red(`  ✗ should have been insufficient`),
      );
    }

    const rules = scoreAnswer(question, cited.answer, retrieval);

    results.push({
      question,
      retrieval,
      cited,
      rules,
      judge: { score: 0, verdict: "", modelId: "", raw: "" },
      citation: citationScore,
      faithfulness: null,
    });
  }

  // Judge + faithfulness scoring
  console.log(pc.dim("\nJudge & faithfulness scoring..."));

  for (const result of results) {
    if (!result.question.outOfScope) {
      result.judge = await withSpinner(`Judge (${result.question.id})`, () =>
        judgeService.judge(result.question, result.cited.answer, result.retrieval),
      );
    }

    if (result.cited.cited && result.cited.cited.confidence !== "insufficient") {
      result.faithfulness = await withSpinner(`Faithfulness (${result.question.id})`, () =>
        faithfulnessJudge.judge(result.cited.cited!),
      );
    }
  }

  // Generate report
  const report = renderDay24Report(results);
  const reportDir = reportPath.substring(0, reportPath.lastIndexOf("/"));
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(reportPath, report, "utf8");

  console.log();
  console.log(pc.green(`✔ Report saved: ${reportPath}`));
}

function renderDay24Report(results: QuestionResult[]): string {
  const lines: string[] = [];
  lines.push("# Day 24 — Citations, sources & anti-hallucination evaluation report");
  lines.push("");
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push("");

  const inScope = results.filter((r) => !r.question.outOfScope);
  const outOfScope = results.filter((r) => r.question.outOfScope);

  // Summary metrics
  lines.push("## Summary");
  lines.push("");

  const sourcesPresent = inScope.filter((r) => r.citation.hasSources).length;
  const quotesPresent = inScope.filter((r) => r.citation.hasQuotes).length;
  const avgJudge = inScope.length > 0
    ? (inScope.reduce((sum, r) => sum + r.judge.score, 0) / inScope.length).toFixed(2)
    : "—";
  const faithfulnessScores = inScope.filter((r) => r.faithfulness).map((r) => r.faithfulness!.score);
  const avgFaithfulness = faithfulnessScores.length > 0
    ? (faithfulnessScores.reduce((a, b) => a + b, 0) / faithfulnessScores.length).toFixed(2)
    : "—";
  const insufficientCorrect = outOfScope.filter((r) => r.citation.isInsufficientCorrect).length;

  lines.push("| Metric | Value |");
  lines.push("|--------|-------|");
  lines.push(`| In-scope questions | ${inScope.length} |`);
  lines.push(`| Out-of-scope questions | ${outOfScope.length} |`);
  lines.push(`| Sources present | ${sourcesPresent}/${inScope.length} |`);
  lines.push(`| Quotes present | ${quotesPresent}/${inScope.length} |`);
  lines.push(`| Avg judge score | ${avgJudge}/3 |`);
  lines.push(`| Avg faithfulness | ${avgFaithfulness}/3 |`);
  lines.push(`| Out-of-scope correctly refused | ${insufficientCorrect}/${outOfScope.length} |`);
  lines.push("");

  // Per-question summary table
  lines.push("## Per-question summary");
  lines.push("");
  lines.push("| # | Question | Sources | Quotes | Confidence | Judge | Faithfulness |");
  lines.push("|---|----------|---------|--------|------------|-------|--------------|");

  for (const r of results) {
    const q = r.question;
    const src = r.citation.hasSources ? "✓" : "✗";
    const qt = r.citation.hasQuotes ? "✓" : "✗";
    const conf = r.citation.confidence;
    const judge = q.outOfScope ? "—" : `${r.judge.score}/3`;
    const faith = r.faithfulness ? `${r.faithfulness.score}/3` : "—";
    const shortQ = q.question.length > 50 ? q.question.slice(0, 50) + "…" : q.question;
    lines.push(`| ${q.id} | ${escapeMd(shortQ)} | ${src} | ${qt} | ${conf} | ${judge} | ${faith} |`);
  }

  lines.push("");

  // Detailed per-question
  for (const r of results) {
    lines.push(`## ${r.question.id}: ${r.question.question}`);
    lines.push("");

    if (r.question.outOfScope) {
      lines.push(`**Type:** out-of-scope`);
      lines.push(`**Retrieval:** ${r.retrieval.status} (${r.retrieval.hitsBeforeFilter} candidates)`);
      lines.push(`**Correctly refused:** ${r.citation.isInsufficientCorrect ? "✓ yes" : "✗ no"}`);
      lines.push(`**Confidence:** ${r.citation.confidence}`);
      lines.push("");
      lines.push(`**Answer:** ${r.cited.answer.slice(0, 200)}`);
      lines.push("");
      continue;
    }

    lines.push(`**Expectation:** ${r.question.expectation}`);
    lines.push("");
    lines.push(`**Retrieval:** ${r.retrieval.status} (${r.retrieval.hitsBeforeFilter}→${r.retrieval.hits.length})`);
    if (r.retrieval.rewrittenQuery) {
      lines.push(`**Rewritten query:** ${r.retrieval.rewrittenQuery}`);
    }
    lines.push("");
    lines.push(`**Confidence:** ${r.citation.confidence}`);
    lines.push(`**Sources:** ${r.citation.sourceCount} | **Quotes:** ${r.citation.quoteCount}`);
    lines.push(`**Rules:** ${r.rules.score}/${r.rules.maxScore} (${r.rules.verdict})`);
    lines.push(`**Judge:** ${r.judge.score}/3 — ${r.judge.verdict}`);
    if (r.faithfulness) {
      lines.push(`**Faithfulness:** ${r.faithfulness.score}/3 — ${r.faithfulness.verdict}`);
    }
    lines.push("");

    lines.push("**Answer:**");
    lines.push("");
    lines.push(r.cited.answer);
    lines.push("");

    if (r.cited.cited && r.cited.cited.sources.length > 0) {
      lines.push("**Sources used:**");
      for (const src of r.cited.cited.sources) {
        lines.push(`- [${src.sourceIndex}] ${src.source} > ${src.section ?? "(none)"}`);
      }
      lines.push("");
    }

    if (r.cited.cited && r.cited.cited.quotes.length > 0) {
      lines.push("**Quotes:**");
      for (const q of r.cited.cited.quotes) {
        lines.push(`- [${q.sourceIndex}] "${q.text}"`);
      }
      lines.push("");
    }
  }

  return lines.join("\n") + "\n";
}

function escapeMd(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function formatCost(costInfo: CostInfo | null): string {
  if (!costInfo) return "—";
  const amount = costInfo.cost < 0.01 ? costInfo.cost.toFixed(6) : costInfo.cost.toFixed(4);
  return `$${amount} (${costInfo.inputTokens}/${costInfo.outputTokens})`;
}

main().catch((error) => {
  console.error(pc.red("Day 24 citation evaluation failed"));
  console.error(error instanceof Error ? error.message : String(error));
  if (error instanceof Error && error.stack) {
    console.error(pc.dim(error.stack));
  }
  process.exit(1);
});
