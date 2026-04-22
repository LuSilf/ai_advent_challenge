import OpenAI from "openai";

import { loadConfig, applyDbOptions } from "./config";
import { initDb } from "./db";

// Storage
import { SqliteSessionRepository } from "./storage/sqlite/session-repository";
import { SqliteMessageRepository } from "./storage/sqlite/message-repository";
import { SqliteFactRepository } from "./storage/sqlite/fact-repository";
import { SqliteModelRepository } from "./storage/sqlite/model-repository";
import { SqliteOptionsRepository } from "./storage/sqlite/options-repository";
import { SqliteCheckpointRepository } from "./storage/sqlite/checkpoint-repository";
import { SqliteProfileRepository } from "./storage/sqlite/profile-repository";
import { SqliteMemoryRepository } from "./storage/sqlite/memory-repository";
import { SqliteTaskRepository } from "./storage/sqlite/task-repository";
import { SqliteTaskStateRepository } from "./storage/sqlite/task-state-repository";
import { SqliteTaskTransitionRepository } from "./storage/sqlite/task-transition-repository";
import { SqliteMcpServerRepository } from "./storage/sqlite/mcp-server-repository";
import { SqliteSchedulerRepository } from "./storage/sqlite/scheduler-repository";

// API
import { OpenAILLMClient } from "./api/openai/llm-client";
import { OllamaEmbedder } from "./api/ollama/ollama-embedder";

// Domain services
import { SessionService } from "./domain/services/session-service";
import { ContextService } from "./domain/services/context-service";
import { CostService } from "./domain/services/cost-service";
import { ChatService } from "./domain/services/chat-service";
import { MemoryService } from "./domain/services/memory-service";
import { ProfileService } from "./domain/services/profile-service";
import { TaskService } from "./domain/services/task-service";
import { TaskStateService } from "./domain/services/task-state-service";
import { McpClientService } from "./domain/services/mcp-client-service";
import { McpConnectionManager } from "./domain/services/mcp-connection-manager";
import { SchedulerService } from "./domain/services/scheduler-service";
import { RagService } from "./domain/services/rag-service";

import { SqliteVectorIndex } from "./storage/sqlite/sqlite-vector-index";
import { readIndexingConfig } from "./indexing-config";

// Presentation
import { startRepl } from "./presentation/repl";

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
const checkpointRepo = new SqliteCheckpointRepository();
const profileRepo = new SqliteProfileRepository();
const memoryRepo = new SqliteMemoryRepository();
const taskRepo = new SqliteTaskRepository();
const taskTransitionRepo = new SqliteTaskTransitionRepository();
const taskStateRepo = new SqliteTaskStateRepository();
const mcpServerRepo = new SqliteMcpServerRepository();
const schedulerRepo = new SqliteSchedulerRepository();
const vectorIndex = new SqliteVectorIndex();

// --- API layer ---
const llmClient = new OpenAILLMClient(openaiClient);
const indexingConfig = readIndexingConfig(optionsRepo);
const ragEmbedder = new OllamaEmbedder({
  baseUrl: indexingConfig.embeddingBaseUrl,
  model: indexingConfig.embeddingModel,
  dimension: indexingConfig.embeddingDim,
});
const ragService = new RagService(ragEmbedder, vectorIndex);

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
const taskService = new TaskService(taskRepo, taskTransitionRepo);
const taskStateService = new TaskStateService(taskStateRepo, llmClient, modelRepo);
const mcpClientService = new McpClientService();
const mcpConnectionManager = new McpConnectionManager(mcpServerRepo, mcpClientService);

// --- Run ---
if (!config.prompt) {
  // REPL mode
  await startRepl({
    config,
    sessionService,
    chatService,
    memoryService,
    contextService,
    costService,
    modelRepo,
    optionsRepo,
    checkpointRepo,
    factRepo,
    llmClient,
    openaiClient,
    profileService,
    taskService,
    mcpServerRepo,
    mcpConnectionManager,
    schedulerRepo,
    ragService,
    taskStateService,
  });
} else {
  // Single-shot mode
  const { printRequestDebug, printResponseDebug, printOutputMarker } = await import("./debug-logger");

  let sessionId: number;
  if (config.sessionId) {
    const session = sessionService.getSession(config.sessionId);
    if (!session) {
      fail(`Сессия #${config.sessionId} не найдена`);
    }
    sessionId = config.sessionId;
  } else {
    sessionId = sessionService.createSession(undefined, config.contextStrategy);
  }

  const chatModel = modelRepo.getRole("chat");
  const modelId = chatModel?.id ?? "openai/gpt-5-nano";

  if (config.debug) {
    printRequestDebug(config, modelId, {
      messageCount: sessionService.getMessageCount(sessionId),
      longTermMemory: memoryService.readMemory("longterm") || undefined,
      workingMemory: memoryService.readMemory("working") || undefined,
    });
  }

  try {
    let wroteOutputNewline = false;

    if (config.debug) {
      printOutputMarker();
    }

    const result = await chatService.sendMessage(sessionId, config.prompt, {
      historyLimit: config.historyLimit,
      systemPrompt: config.systemPrompt,
      useStreaming: config.useStreaming,
      memoryBlocks: memoryService.getMemoryBlocks() || undefined,
      temperature: config.temperature,
      topP: config.topP,
      maxCompletionTokens: config.maxCompletionTokens,
      onDelta: (text) => process.stdout.write(text),
    });

    if (!config.useStreaming) {
      process.stdout.write(result.response.content);
    }

    if (config.debug && result.rawResponse) {
      process.stdout.write("\n");
      wroteOutputNewline = true;
      printResponseDebug(result.rawResponse as any, Date.now());
    }

    if (result.costInfo) {
      if (!wroteOutputNewline) {
        process.stdout.write("\n");
        wroteOutputNewline = true;
      }
      console.error(costService.formatCost(result.costInfo));
    }

    // Auto-title
    if (result.response.content) {
      const session = sessionService.getSession(sessionId);
      if (session && !session.title && sessionService.getMessageCount(sessionId) === 2) {
        try {
          const titleModelObj = modelRepo.getRole("title");
          const titleModelId = titleModelObj?.id ?? "llama3.2:3b";
          const titleResponse = await openaiClient.chat.completions.create({
            model: titleModelId,
            messages: [
              { role: "system", content: "Придумай короткое название (до 50 символов) для диалога по первому обмену сообщениями. Ответь только названием, без кавычек." },
              { role: "user", content: `Пользователь: ${config.prompt}\nАссистент: ${result.response.content}` },
            ],
            stream: false,
          });
          const title = titleResponse.choices[0]?.message?.content?.trim();
          if (title) {
            sessionService.autoTitle(sessionId, title);
          }
        } catch {
          // не блокируем основной поток
        }
      }
    }

    if (!wroteOutputNewline) {
      process.stdout.write("\n");
    }
    process.exit(0);
  } catch (error) {
    if (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError") {
      console.error(`Request timed out after ${config.effectiveTimeoutMs}ms`);
      console.error("Check OPENAI_BASE_URL and network connectivity");
      process.exit(1);
    }

    const status = typeof error === "object" && error !== null && "status" in error ? Number((error as any).status) : undefined;
    if (status === 429) {
      console.error("Rate limit reached (HTTP 429)");
      console.error("Switch model/provider or wait before the next request");
      console.error("Also check account quota/credits on the provider side");
      process.exit(1);
    }

    console.error("LLM request failed");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
