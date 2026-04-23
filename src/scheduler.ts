/**
 * Standalone scheduler — запуск без REPL.
 * Выполняет задачи по расписанию, отправляет результаты через notify-send.
 *
 * Использование: bun run src/scheduler.ts
 */

import OpenAI from "openai";
import pc from "picocolors";

import { loadConfig, applyDbOptions } from "./config";
import { initDb } from "./db";

// Storage
import { SqliteSessionRepository } from "./storage/sqlite/session-repository";
import { SqliteMessageRepository } from "./storage/sqlite/message-repository";
import { SqliteFactRepository } from "./storage/sqlite/fact-repository";
import { SqliteModelRepository } from "./storage/sqlite/model-repository";
import { SqliteOptionsRepository } from "./storage/sqlite/options-repository";
import { SqliteProfileRepository } from "./storage/sqlite/profile-repository";
import { SqliteMemoryRepository } from "./storage/sqlite/memory-repository";
import { SqliteMcpServerRepository } from "./storage/sqlite/mcp-server-repository";
import { SqliteSchedulerRepository } from "./storage/sqlite/scheduler-repository";

// API
import { OpenAILLMClient } from "./api/openai/llm-client";

// Domain services
import { SessionService } from "./domain/services/session-service";
import { ContextService } from "./domain/services/context-service";
import { CostService } from "./domain/services/cost-service";
import { ChatService } from "./domain/services/chat-service";
import { MemoryService } from "./domain/services/memory-service";
import { ProfileService } from "./domain/services/profile-service";
import { McpClientService } from "./domain/services/mcp-client-service";
import { McpConnectionManager } from "./domain/services/mcp-connection-manager";
import { SchedulerService } from "./domain/services/scheduler-service";
import type { ToolProvider } from "./domain/services/chat-service";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

// --- Config & DB ---
const config = loadConfig(Bun.argv.slice(2), fail);
initDb(config.historyDb);

const optionsRepo = new SqliteOptionsRepository();
applyDbOptions(config, (key) => optionsRepo.get(key));

// --- OpenAI client ---
const openaiClient = new OpenAI({
  apiKey: config.apiKey,
  baseURL: config.baseUrl,
  timeout: config.effectiveTimeoutMs,
  maxRetries: 0,
});

// --- Storage layer ---
const sessionRepo = new SqliteSessionRepository();
const messageRepo = new SqliteMessageRepository();
const factRepo = new SqliteFactRepository();
const modelRepo = new SqliteModelRepository();
const profileRepo = new SqliteProfileRepository();
const memoryRepo = new SqliteMemoryRepository();
const mcpServerRepo = new SqliteMcpServerRepository();
const schedulerRepo = new SqliteSchedulerRepository();

// --- API layer ---
const llmClient = new OpenAILLMClient(openaiClient);

// --- Domain services ---
const sessionService = new SessionService(sessionRepo, messageRepo);
const contextService = new ContextService();
const costService = new CostService(modelRepo);
const profileService = new ProfileService(profileRepo, optionsRepo);
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
const memoryService = new MemoryService(memoryRepo, llmClient, modelRepo);
const mcpClientService = new McpClientService();
const mcpConnectionManager = new McpConnectionManager(mcpServerRepo, mcpClientService);

// --- Notify ---
async function notifySend(title: string, body: string): Promise<void> {
  try {
    const truncated = body.length > 500 ? body.slice(0, 500) + "..." : body;
    const proc = Bun.spawn(["notify-send", "--app-name=Scheduler", title, truncated]);
    await proc.exited;
  } catch {
    // notify-send may not be available
  }
}

// --- Build tool provider ---
function buildToolProvider(): ToolProvider | undefined {
  const tools = mcpConnectionManager.getAvailableTools();
  if (tools.length === 0) return undefined;

  return {
    getToolDefinitions: () =>
      tools.map((t) => ({
        name: `${t.serverName}__${t.name}`,
        description: t.description,
        parameters: t.inputSchema,
      })),
    callTool: async (name, args) => {
      const sep = name.indexOf("__");
      const serverName = sep >= 0 ? name.slice(0, sep) : "";
      const toolName = sep >= 0 ? name.slice(sep + 2) : name;
      return mcpConnectionManager.callTool(serverName, toolName, args);
    },
  };
}

// --- Main ---
async function main() {
  console.log(pc.bold("Standalone Scheduler"));

  // Подключаем MCP-серверы
  const mcpConfigs = mcpServerRepo.getAll();
  if (mcpConfigs.length > 0) {
    console.log(pc.dim(`Подключение к ${mcpConfigs.length} MCP-серверам...`));
    const statuses = await mcpConnectionManager.connectAll();
    for (const s of statuses) {
      if (s.status === "connected") {
        console.log(pc.green(`  ✔ ${s.serverName} — ${s.toolCount} инструментов`));
      } else {
        console.log(pc.red(`  ✘ ${s.serverName} — ${s.error ?? "ошибка подключения"}`));
      }
    }
  }

  // Находим сессию
  const lastSession = sessionService.getLastSession();
  if (!lastSession) {
    fail("Нет активных сессий. Создайте сессию через REPL.");
  }
  const sessionId = lastSession.id;
  console.log(pc.dim(`Сессия #${sessionId}: "${lastSession.title ?? "(без названия)"}"`));

  // Создаём планировщик
  const schedulerService = new SchedulerService({
    schedulerRepo,
    chatService,
    getSessionId: () => sessionId,
    getSystemPrompt: () => config.systemPrompt,
    getToolProvider: () => buildToolProvider(),
    getMemoryBlocks: () => memoryService.getMemoryBlocks() || undefined,
    getSendOptions: () => ({
      temperature: config.temperature,
      topP: config.topP,
      maxCompletionTokens: config.maxCompletionTokens,
    }),
    onExecution: async (task, execution) => {
      if (execution.status === "success") {
        console.log(`${pc.bgCyan(pc.black(` Задача: ${task.name} `))}`);
        const preview = execution.result && execution.result.length > 300
          ? execution.result.slice(0, 300) + "..."
          : execution.result;
        console.log(pc.cyan(preview ?? "(пустой результат)"));
        console.log(pc.dim(`  ${execution.tokensUsed} tokens, ${execution.finishedAt}`));
        await notifySend(`Задача: ${task.name}`, execution.result ?? "");
      } else {
        console.log(`${pc.bgRed(pc.white(` Задача: ${task.name} — ошибка `))}`);
        console.log(pc.red(execution.error ?? "Неизвестная ошибка"));
        await notifySend(`Ошибка: ${task.name}`, execution.error ?? "Неизвестная ошибка");
      }
      console.log();
    },
  });

  const allTasks = schedulerService.getAllTasks().filter((t) => t.enabled);
  if (allTasks.length === 0) {
    fail("Нет активных задач. Создайте задачи через REPL: /schedule create");
  }

  console.log(pc.green(`Запущен планировщик (${allTasks.length} задач)`));
  for (const t of allTasks) {
    const next = t.nextRunAt ? new Date(t.nextRunAt).toLocaleString() : "—";
    console.log(pc.dim(`  #${t.id} "${t.name}" cron: ${t.cronExpression}, следующий: ${next}`));
  }
  console.log(pc.dim("Ctrl+C для остановки\n"));

  schedulerService.start();

  // Graceful shutdown
  const shutdown = async () => {
    console.log(pc.dim("\nОстановка..."));
    schedulerService.stop();
    await mcpConnectionManager.disconnectAll();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Keep process alive
  await new Promise(() => {});
}

main().catch((err) => {
  console.error(pc.red("Критическая ошибка:"), err);
  process.exit(1);
});
