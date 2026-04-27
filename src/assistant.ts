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
import { McpClientService, type McpConnection } from "./domain/services/mcp-client-service";
import { runAssistantRepl } from "./presentation/repl/assistant-repl";
import { buildDocsIndexer, runReindex } from "./presentation/repl/assistant-reindex";
import type { AssistantToolDefinition, AssistantToolCall } from "./domain/ports/assistant-llm";

function fail(message: string): never {
  console.error(pc.red(message));
  process.exit(1);
}

const SYSTEM_PROMPT_HEADER = [
  "Ты — AI-ассистент разработчика проекта ai-advent-challenge на Bun/TypeScript.",
  "У тебя есть RAG-контекст из README и исходников проекта (см. ниже)",
  "и MCP-инструменты для git и файловой системы (git_branch, git_status, git_log, git_diff, list_files).",
  "Если вопрос про состояние репозитория (ветка, изменения, коммиты, файлы) — используй tools.",
  "Отвечай по-русски. Будь точен и краток.",
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

const mcpService = new McpClientService();
let mcpConnection: McpConnection | null = null;
let availableTools: AssistantToolDefinition[] = [];

try {
  mcpConnection = await mcpService.connect({
    name: "day31-project-tools",
    command: "bun",
    args: ["run", "scripts/day31/mcp-server.ts"],
    cwd: config.projectRoot,
  });
  const mcpTools = await mcpService.listToolsFromConnection(mcpConnection);
  availableTools = mcpTools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
  }));
  console.log(pc.dim(`[mcp] connected, ${availableTools.length} tools available`));
} catch (err) {
  console.error(pc.yellow(`[mcp] failed to start MCP server: ${err instanceof Error ? err.message : String(err)}`));
  console.error(pc.yellow("[mcp] continuing without MCP tools"));
}

const toolExecutor = mcpConnection
  ? async (call: AssistantToolCall) => {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = call.arguments.trim().length > 0 ? (JSON.parse(call.arguments) as Record<string, unknown>) : {};
      } catch (err) {
        return { content: `invalid JSON in tool arguments: ${err instanceof Error ? err.message : String(err)}`, isError: true };
      }
      return mcpService.callTool(mcpConnection!, call.name, parsed);
    }
  : undefined;

const orchestrator = new AssistantOrchestrator({
  llmClient,
  embedder,
  vectorIndex,
  model: config.llmModel,
  topK: config.topK,
  systemPromptHeader: SYSTEM_PROMPT_HEADER,
  toolLoopMax: config.toolLoopMax,
  tools: availableTools.length > 0 ? availableTools : undefined,
  toolExecutor,
});

const history: AssistantHistoryEntry[] = [];

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  if (mcpConnection) {
    try {
      await mcpService.disconnect(mcpConnection);
    } catch {
      // best-effort
    }
  }
}

process.on("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});

const handlers = {
  async onHelp(question: string): Promise<void> {
    let answer = "";
    let hasOutput = false;
    for await (const event of orchestrator.ask(question, history)) {
      if (event.kind === "retrieval") {
        process.stdout.write(pc.dim(`[retrieval] ${event.hits.length} chunks\n`));
      } else if (event.kind === "tool_call") {
        const argsPretty = event.args.length > 100 ? event.args.slice(0, 97) + "..." : event.args;
        process.stdout.write(pc.dim(`→ ${event.name}(${argsPretty})\n`));
      } else if (event.kind === "tool_result") {
        const head = event.result.replace(/\n/g, " ").slice(0, 200);
        const marker = event.isError ? pc.red("← error: ") : pc.dim("← ");
        process.stdout.write(marker + pc.dim(head) + (event.result.length > 200 ? pc.dim("...") : "") + "\n");
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
    if (availableTools.length === 0) {
      console.log(pc.yellow("[tools] MCP не подключён"));
      return;
    }
    console.log(pc.bold("Доступные MCP-инструменты:"));
    for (const t of availableTools) {
      console.log(`  ${pc.green(t.name)} — ${t.description}`);
    }
  },
  async onClear(): Promise<void> {
    history.length = 0;
    console.log(pc.dim("[clear] история сброшена"));
  },
  async onQuit(): Promise<void> {
    console.log(pc.dim("[assistant] до встречи."));
    await shutdown();
    process.exit(0);
  },
};

await runAssistantRepl({ handlers });
