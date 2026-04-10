/**
 * E2E тест: полная цепочка search → summarize → saveToFile
 *
 * Запуск: bun run scripts/mcp-servers/e2e-test.ts
 *
 * Требует: OPENAI_API_KEY, OPENAI_MODEL, OPENAI_BASE_URL в .env или environment
 */

import OpenAI from "openai";
import { resolve } from "node:path";
import { existsSync, unlinkSync } from "node:fs";

import { loadConfig } from "../../src/config";
import { initDb } from "../../src/db";
import { SqliteSessionRepository } from "../../src/storage/sqlite/session-repository";
import { SqliteMessageRepository } from "../../src/storage/sqlite/message-repository";
import { SqliteFactRepository } from "../../src/storage/sqlite/fact-repository";
import { SqliteModelRepository } from "../../src/storage/sqlite/model-repository";
import { SqliteOptionsRepository } from "../../src/storage/sqlite/options-repository";
import { SqliteMcpServerRepository } from "../../src/storage/sqlite/mcp-server-repository";
import { OpenAILLMClient } from "../../src/api/openai/llm-client";
import { SessionService } from "../../src/domain/services/session-service";
import { ContextService } from "../../src/domain/services/context-service";
import { CostService } from "../../src/domain/services/cost-service";
import { ChatService, type ToolCallEvent } from "../../src/domain/services/chat-service";
import { McpClientService } from "../../src/domain/services/mcp-client-service";
import { McpConnectionManager } from "../../src/domain/services/mcp-connection-manager";

import pc from "picocolors";

const PROJECT_ROOT = resolve(import.meta.dir, "../..");
const BUN_PATH = process.argv[0];

// --- Setup ---
const config = loadConfig([], (msg) => { console.error(msg); process.exit(1); });
initDb(config.historyDb);

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
const optionsRepo = new SqliteOptionsRepository();
const mcpServerRepo = new SqliteMcpServerRepository();

const llmClient = new OpenAILLMClient(openaiClient);
const sessionService = new SessionService(sessionRepo, messageRepo);
const contextService = new ContextService();
const costService = new CostService(modelRepo);
const chatService = new ChatService(llmClient, sessionService, contextService, costService, messageRepo, factRepo, modelRepo);
const mcpClientService = new McpClientService();
const mcpConnectionManager = new McpConnectionManager(mcpServerRepo, mcpClientService);

// --- Register MCP servers ---
const servers = [
  { name: "github-search", command: BUN_PATH, args: ["run", resolve(PROJECT_ROOT, "scripts/mcp-servers/search.ts")] },
  { name: "summarize", command: BUN_PATH, args: ["run", resolve(PROJECT_ROOT, "scripts/mcp-servers/summarize.ts")] },
  { name: "save-to-file", command: BUN_PATH, args: ["run", resolve(PROJECT_ROOT, "scripts/mcp-servers/save-to-file.ts")] },
];

for (const srv of servers) {
  try { mcpServerRepo.remove(srv.name); } catch {}
  mcpServerRepo.add({ ...srv, cwd: PROJECT_ROOT });
}

console.log(pc.bold("\n=== E2E Test: MCP Tool Composition ===\n"));

// --- Connect ---
console.log("Подключение к MCP-серверам...");
const statuses = await mcpConnectionManager.connectAll();
for (const s of statuses) {
  const icon = s.status === "connected" ? pc.green("✓") : pc.red("✗");
  console.log(`  ${icon} ${s.serverName}: ${s.status} (${s.toolCount ?? 0} tools)`);
}

// --- Build tool provider ---
const availableTools = mcpConnectionManager.getAvailableTools();
const toolProvider = {
  getToolDefinitions() {
    return availableTools.map((t) => ({
      name: `${t.serverName}__${t.name}`,
      description: t.description,
      parameters: t.inputSchema,
    }));
  },
  async callTool(name: string, args: Record<string, unknown>) {
    const sep = name.indexOf("__");
    const serverName = sep >= 0 ? name.slice(0, sep) : "";
    const toolName = sep >= 0 ? name.slice(sep + 2) : name;
    return mcpConnectionManager.callTool(serverName, toolName, args);
  },
};

console.log(`\nДоступные инструменты: ${availableTools.map((t) => `${t.serverName}__${t.name}`).join(", ")}\n`);

// --- Test ---
const sessionId = sessionService.createSession("e2e-test-composition");

const prompt = "Найди последние 2 вмердженных PR в spring-projects/spring-boot. Суммаризируй каждый отдельно и сохрани всё в файл spring-boot-summary.md в формате Markdown.";

console.log(pc.bold(`Промпт: ${prompt}\n`));
console.log(pc.dim("─".repeat(60)));

const toolCalls: ToolCallEvent[] = [];

const result = await chatService.sendMessage(sessionId, prompt, {
  historyLimit: 50,
  systemPrompt: "Ты — полезный ассистент. Используй доступные инструменты для выполнения задач. Для каждого PR вызывай summarize отдельно. Суммаризируй на русском языке.",
  useStreaming: false,
  toolProvider,
  onToolCall: (event) => {
    toolCalls.push(event);
    if (event.result) {
      const status = event.isError ? pc.red("ERROR") : pc.green("OK");
      console.log(`  ${pc.cyan("→")} ${event.serverName}/${event.toolName} [${status}] (${event.result.length} chars)`);
    } else {
      console.log(`  ${pc.yellow("⚡")} ${event.serverName}/${event.toolName}(${JSON.stringify(event.arguments).slice(0, 100)}...)`);
    }
  },
  maxToolRounds: 20,
});

console.log(pc.dim("─".repeat(60)));
console.log(pc.bold("\nОтвет LLM:"));
console.log(result.response.content);

if (result.costInfo) {
  console.log(`\n${costService.formatCost(result.costInfo)}`);
}

// --- Verify ---
console.log(pc.bold("\n=== Проверка результатов ===\n"));

const toolCallNames = toolCalls.filter((t) => !t.result).map((t) => `${t.serverName}__${t.toolName}`);
console.log(`Tool calls: ${toolCallNames.join(" → ")}`);

const hasSearch = toolCallNames.some((n) => n.includes("search_pulls"));
const hasSummarize = toolCallNames.some((n) => n.includes("summarize"));
const hasSave = toolCallNames.some((n) => n.includes("save_to_file"));

console.log(`  ${hasSearch ? pc.green("✓") : pc.red("✗")} search_pulls вызван`);
console.log(`  ${hasSummarize ? pc.green("✓") : pc.red("✗")} summarize вызван`);
console.log(`  ${hasSave ? pc.green("✓") : pc.red("✗")} save_to_file вызван`);

const summaryFile = resolve(PROJECT_ROOT, "spring-boot-summary.md");
const fileExists = existsSync(summaryFile);
console.log(`  ${fileExists ? pc.green("✓") : pc.red("✗")} Файл spring-boot-summary.md создан`);

if (fileExists) {
  const content = await Bun.file(summaryFile).text();
  console.log(`  Размер: ${content.length} символов`);
  console.log(pc.dim("\n--- Содержимое файла ---"));
  console.log(content);
  console.log(pc.dim("--- Конец файла ---\n"));
  // Cleanup
  unlinkSync(summaryFile);
  console.log("  Файл удалён (cleanup)");
}

// Cleanup
await mcpConnectionManager.disconnectAll();
console.log("\nMCP-серверы отключены.");

const allPassed = hasSearch && hasSummarize && hasSave && fileExists;
console.log(pc.bold(`\n${allPassed ? pc.green("✓ E2E тест пройден!") : pc.red("✗ E2E тест не пройден")}`));

process.exit(allPassed ? 0 : 1);
