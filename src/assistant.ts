import OpenAI from "openai";
import pc from "picocolors";

import { initDb } from "./db";
import { OllamaEmbedder } from "./api/ollama/ollama-embedder";
import { OpenAIAssistantLLMClient } from "./api/openai/openai-assistant-llm";
import { SqliteVectorIndex } from "./storage/sqlite/sqlite-vector-index";
import { loadAssistantConfig } from "./domain/services/assistant-config";
import {
  AssistantOrchestrator,
  type AssistantHistoryEntry,
} from "./domain/services/assistant-orchestrator";
import { runAssistantRepl } from "./presentation/repl/assistant-repl";
import { buildDocsIndexer, runReindex } from "./presentation/repl/assistant-reindex";

function fail(message: string): never {
  console.error(pc.red(message));
  process.exit(1);
}

const SYSTEM_PROMPT_HEADER = [
  "Ты — AI-ассистент разработчика проекта ai-advent-challenge на Bun/TypeScript.",
  "Тебе доступен RAG-контекст из README и исходников проекта (см. ниже).",
  "Отвечай по-русски. Будь точен и краток. Если упоминаешь код — указывай файл/строки.",
].join(" ");

const EMBEDDING_DIMENSION = 768;

const subcommand = process.argv[2];

const config = loadAssistantConfig((name) => process.env[name], fail);

initDb(config.dbPath);

if (subcommand === "reindex") {
  const indexer = buildDocsIndexer(config);
  await runReindex(indexer, process.stdout);
  process.exit(0);
}

if (subcommand !== undefined) {
  fail(`Unknown subcommand: ${subcommand}. Usage: bun run assistant [reindex]`);
}

console.log(pc.dim(`[assistant] llm: ${config.llmModel} via ${config.llmBaseUrl}`));
console.log(pc.dim(`[assistant] db: ${config.dbPath}, top_k=${config.topK}, tool_loop_max=${config.toolLoopMax}`));

const indexer = buildDocsIndexer(config);

const openai = new OpenAI({
  apiKey: config.llmApiKey,
  baseURL: config.llmBaseUrl,
  maxRetries: 0,
});
const llmClient = new OpenAIAssistantLLMClient(openai);
const embedder = new OllamaEmbedder({
  baseUrl: config.embeddingBaseUrl,
  model: config.embeddingModel,
  dimension: EMBEDDING_DIMENSION,
});
const vectorIndex = new SqliteVectorIndex();
const orchestrator = new AssistantOrchestrator({
  llmClient,
  embedder,
  vectorIndex,
  model: config.llmModel,
  topK: config.topK,
  systemPromptHeader: SYSTEM_PROMPT_HEADER,
  toolLoopMax: config.toolLoopMax,
});

const history: AssistantHistoryEntry[] = [];

const handlers = {
  async onHelp(question: string): Promise<void> {
    let answer = "";
    let hasOutput = false;
    for await (const event of orchestrator.ask(question, history)) {
      if (event.kind === "retrieval") {
        process.stdout.write(pc.dim(`[retrieval] ${event.hits.length} chunks\n`));
      } else if (event.kind === "token") {
        process.stdout.write(event.delta);
        answer += event.delta;
        hasOutput = true;
      } else if (event.kind === "final") {
        if (hasOutput) process.stdout.write("\n");
        if (event.citations.length > 0) {
          process.stdout.write(pc.dim("\nИсточники:\n"));
          for (const c of event.citations) {
            const range =
              c.lineStart !== undefined && c.lineEnd !== undefined
                ? `${c.source}:${c.lineStart}-${c.lineEnd}`
                : c.source;
            process.stdout.write(pc.dim(`  [${c.label}] ${range}\n`));
          }
        }
      } else if (event.kind === "error") {
        process.stdout.write(pc.red(`[error] ${event.message}\n`));
      }
    }
    if (answer.trim().length > 0) {
      history.push({ role: "user", content: question });
      history.push({ role: "assistant", content: answer });
    }
  },
  async onReindex(): Promise<void> {
    await runReindex(indexer, process.stdout);
  },
  async onTools(): Promise<void> {
    console.log(pc.yellow("[stub] /tools — MCP не подключён, ждите phase 4"));
  },
  async onClear(): Promise<void> {
    history.length = 0;
    console.log(pc.dim("[clear] история сброшена"));
  },
  async onQuit(): Promise<void> {
    console.log(pc.dim("[assistant] до встречи."));
    process.exit(0);
  },
};

await runAssistantRepl({ handlers });
