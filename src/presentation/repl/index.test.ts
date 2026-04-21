import { describe, test, expect, beforeEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleCommand, type ReplDeps, type ReplState } from "./index";
import { initDb } from "../../db";

import { SqliteSessionRepository } from "../../storage/sqlite/session-repository";
import { SqliteMessageRepository } from "../../storage/sqlite/message-repository";
import { SqliteFactRepository } from "../../storage/sqlite/fact-repository";
import { SqliteModelRepository } from "../../storage/sqlite/model-repository";
import { SqliteOptionsRepository } from "../../storage/sqlite/options-repository";
import { SqliteCheckpointRepository } from "../../storage/sqlite/checkpoint-repository";
import { SqliteProfileRepository } from "../../storage/sqlite/profile-repository";
import { SqliteMemoryRepository } from "../../storage/sqlite/memory-repository";

import { SessionService } from "../../domain/services/session-service";
import { ContextService } from "../../domain/services/context-service";
import { CostService } from "../../domain/services/cost-service";
import { ChatService } from "../../domain/services/chat-service";
import { MemoryService } from "../../domain/services/memory-service";
import { ProfileService } from "../../domain/services/profile-service";
import { TaskService } from "../../domain/services/task-service";
import { SqliteTaskRepository } from "../../storage/sqlite/task-repository";
import { SqliteTaskTransitionRepository } from "../../storage/sqlite/task-transition-repository";
import { SqliteMcpServerRepository } from "../../storage/sqlite/mcp-server-repository";
import { SqliteSchedulerRepository } from "../../storage/sqlite/scheduler-repository";
import { McpClientService } from "../../domain/services/mcp-client-service";
import { McpConnectionManager } from "../../domain/services/mcp-connection-manager";
import type { LLMClient, StreamEvent } from "../../domain/ports/llm-client";
import type { LLMRequest, LLMResponse } from "../../domain/models";
import type { AppConfig } from "../../config";
import { DEFAULT_RAG_STRATEGY, DEFAULT_RAG_TOP_K } from "./rag";

function freshDb(): string {
  const path = join(tmpdir(), `test-repl-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  initDb(path);
  return path;
}

function createMockLLMClient(): LLMClient {
  return {
    async send(): Promise<LLMResponse & { rawResponse?: unknown }> {
      return { content: "mock", inputTokens: 10, outputTokens: 5 };
    },
    async *stream(): AsyncIterable<StreamEvent> {
      yield { type: "done", response: { content: "mock", inputTokens: 10, outputTokens: 5 } };
    },
  };
}

function createTestConfig(): AppConfig {
  return {
    prompt: "",
    apiKey: "test",
    baseUrl: "http://localhost",
    systemPrompt: "test",
    effectiveTimeoutMs: 5000,
    debug: false,
    useStreaming: false,
    historyDb: ":memory:",
    historyLimit: 50,
    contextStrategy: "full",
    day25Mode: false,
  };
}

describe("presentation/repl handleCommand", () => {
  let deps: ReplDeps;
  let state: ReplState;

  beforeEach(() => {
    const dbPath = freshDb();
    const tempDir = join(tmpdir(), `test-mem-${Date.now()}`);

    const sessionRepo = new SqliteSessionRepository();
    const messageRepo = new SqliteMessageRepository();
    const factRepo = new SqliteFactRepository();
    const modelRepo = new SqliteModelRepository();
    const optionsRepo = new SqliteOptionsRepository();
    const checkpointRepo = new SqliteCheckpointRepository();
    const profileRepo = new SqliteProfileRepository();
    const memoryRepo = new SqliteMemoryRepository();
    const taskRepo = new SqliteTaskRepository();
    const llmClient = createMockLLMClient();

    const sessionService = new SessionService(sessionRepo, messageRepo);
    const contextService = new ContextService();
    const costService = new CostService(modelRepo);
    const profileService = new ProfileService(profileRepo, optionsRepo);
    const chatService = new ChatService(llmClient, sessionService, contextService, costService, messageRepo, factRepo, modelRepo, profileService);
    const memoryService = new MemoryService(memoryRepo, llmClient, modelRepo);
    const taskTransitionRepo = new SqliteTaskTransitionRepository();
    const taskService = new TaskService(taskRepo, taskTransitionRepo);
    const mcpServerRepo = new SqliteMcpServerRepository();
    const schedulerRepo = new SqliteSchedulerRepository();
    const mcpClientService = new McpClientService();
    const mcpConnectionManager = new McpConnectionManager(mcpServerRepo, mcpClientService);

    deps = {
      config: createTestConfig(),
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
      openaiClient: {} as any,
      profileService,
      taskService,
      mcpServerRepo,
      mcpConnectionManager,
      schedulerRepo,
    };

    const id = sessionService.createSession(undefined, "full");
    state = {
      sessionId: id,
      messagesSinceReconciliation: 0,
      rag: {
        enabled: false,
        strategy: DEFAULT_RAG_STRATEGY,
        topK: DEFAULT_RAG_TOP_K,
      },
    };
  });

  test("/rag shows current status", async () => {
    const result = await handleCommand("/rag", "", state, deps);
    expect(result).toBeNull();
  });

  test("/rag on enables rag", async () => {
    await handleCommand("/rag", "on", state, deps);
    expect(state.rag.enabled).toBe(true);
  });

  test("/rag off disables rag", async () => {
    state.rag.enabled = true;
    await handleCommand("/rag", "off", state, deps);
    expect(state.rag.enabled).toBe(false);
    expect(deps.optionsRepo.get("rag_enabled")).toBe("false");
  });

  test("/rag strategy updates strategy and persists it", async () => {
    await handleCommand("/rag", "strategy fixed", state, deps);
    expect(state.rag.strategy).toBe("fixed");
    expect(deps.optionsRepo.get("rag_strategy")).toBe("fixed");
  });

  test("/rag topk updates topK and persists it", async () => {
    await handleCommand("/rag", "topk 7", state, deps);
    expect(state.rag.topK).toBe(7);
    expect(deps.optionsRepo.get("rag_top_k")).toBe("7");
  });

  test("/new creates new session", async () => {
    const oldId = state.sessionId;
    await handleCommand("/new", "", state, deps);
    expect(state.sessionId).not.toBe(oldId);
  });

  test("/list shows sessions", async () => {
    const result = await handleCommand("/list", "", state, deps);
    expect(result).toBeNull();
  });

  test("/switch changes session", async () => {
    const id2 = deps.sessionService.createSession("second");
    await handleCommand("/switch", String(id2), state, deps);
    expect(state.sessionId).toBe(id2);
  });

  test("/switch rejects invalid id", async () => {
    await handleCommand("/switch", "abc", state, deps);
    // should not change
  });

  test("/clear clears messages", async () => {
    deps.sessionService.addMessage(state.sessionId, "user", "test");
    await handleCommand("/clear", "", state, deps);
    expect(deps.sessionService.getHistory(state.sessionId)).toHaveLength(0);
  });

  test("/delete removes session and creates new one if active", async () => {
    const id = state.sessionId;
    await handleCommand("/delete", String(id), state, deps);
    expect(state.sessionId).not.toBe(id);
    expect(deps.sessionService.getSession(id)).toBeNull();
  });

  test("/rename changes session title", async () => {
    await handleCommand("/rename", "новое имя", state, deps);
    expect(deps.sessionService.getSession(state.sessionId)!.title).toBe("новое имя");
  });

  test("/strategy shows current strategy", async () => {
    const result = await handleCommand("/strategy", "", state, deps);
    expect(result).toBeNull();
  });

  test("/strategy changes strategy", async () => {
    await handleCommand("/strategy", "sliding", state, deps);
    expect(deps.sessionService.getStrategy(state.sessionId)).toBe("sliding");
  });

  test("/strategy rejects invalid", async () => {
    await handleCommand("/strategy", "invalid", state, deps);
    expect(deps.sessionService.getStrategy(state.sessionId)).toBe("full");
  });

  test("/models shows models", async () => {
    const result = await handleCommand("/models", "", state, deps);
    expect(result).toBeNull();
  });

  test("/roles shows roles", async () => {
    const result = await handleCommand("/roles", "", state, deps);
    expect(result).toBeNull();
  });

  test("/set_model changes role", async () => {
    await handleCommand("/set_model", "chat deepseek/deepseek-v3.2", state, deps);
    expect(deps.modelRepo.getRole("chat")!.id).toBe("deepseek/deepseek-v3.2");
  });

  test("/options shows options", async () => {
    const result = await handleCommand("/options", "", state, deps);
    expect(result).toBeNull();
  });

  test("/set changes option", async () => {
    await handleCommand("/set", "memory_interval 10", state, deps);
    expect(deps.optionsRepo.get("memory_interval")).toBe("10");
  });

  test("/save_facts saves to working memory", async () => {
    await handleCommand("/save_facts", "project fact", state, deps);
    expect(deps.memoryService.readMemory("working")).toContain("project fact");
  });

  test("/facts shows working memory", async () => {
    deps.memoryService.writeMemory("working", "test memory");
    const result = await handleCommand("/facts", "", state, deps);
    expect(result).toBeNull();
  });

  test("/memory shows longterm memory", async () => {
    deps.memoryService.writeMemory("longterm", "test longterm");
    const result = await handleCommand("/memory", "", state, deps);
    expect(result).toBeNull();
  });

  test("/remember without rl falls back to append", async () => {
    await handleCommand("/remember", "запомни это", state, deps);
    expect(deps.memoryService.readMemory("longterm")).toContain("запомни это");
  });

  test("/help returns null", async () => {
    const result = await handleCommand("/help", "", state, deps);
    expect(result).toBeNull();
  });

  test("unknown command returns null", async () => {
    const result = await handleCommand("/unknown", "", state, deps);
    expect(result).toBeNull();
  });

  test("/checkpoint and /branch work", async () => {
    deps.sessionService.addMessage(state.sessionId, "user", "msg1");
    deps.sessionService.addMessage(state.sessionId, "assistant", "msg2");
    await handleCommand("/checkpoint", "", state, deps);
    const oldId = state.sessionId;
    await handleCommand("/branch", "my-branch", state, deps);
    expect(state.sessionId).not.toBe(oldId);
  });

  test("/set with insufficient args shows error", async () => {
    const result = await handleCommand("/set", "onlykey", state, deps);
    expect(result).toBeNull();
  });

  test("/set custom_key hello world", async () => {
    await handleCommand("/set", "custom_key hello world", state, deps);
    expect(deps.optionsRepo.get("custom_key")).toBe("hello world");
  });

  // Profile commands

  test("/profile shows no active profile initially", async () => {
    const result = await handleCommand("/profile", "", state, deps);
    expect(result).toBeNull();
  });

  test("/profile create creates a profile", async () => {
    await handleCommand("/profile", "create dev", state, deps);
    const profiles = deps.profileService.getAllProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0].name).toBe("dev");
  });

  test("/profile list shows profiles", async () => {
    deps.profileService.createProfile("test");
    const result = await handleCommand("/profile", "list", state, deps);
    expect(result).toBeNull();
  });

  test("/profile switch activates profile", async () => {
    const id = deps.profileService.createProfile("test");
    await handleCommand("/profile", `switch ${id}`, state, deps);
    expect(deps.profileService.getActiveProfile()!.id).toBe(id);
  });

  test("/profile delete removes profile", async () => {
    const id = deps.profileService.createProfile("test");
    await handleCommand("/profile", `delete ${id}`, state, deps);
    expect(deps.profileService.getProfile(id)).toBeNull();
  });

  // Task commands

  test("/task без активной задачи показывает сообщение", async () => {
    const result = await handleCommand("/task", "", state, deps);
    expect(result).toBeNull();
  });

  test('/task create создаёт задачу', async () => {
    await handleCommand("/task", 'create "Реализовать фичу"', state, deps);
    const tasks = deps.taskService.getSessionTasks(state.sessionId);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Реализовать фичу");
    expect(tasks[0].phase).toBe("planning");
  });

  test("/task create без описания показывает ошибку", async () => {
    await handleCommand("/task", "create", state, deps);
    const tasks = deps.taskService.getSessionTasks(state.sessionId);
    expect(tasks).toHaveLength(0);
  });

  test("/task показывает активную задачу", async () => {
    deps.taskService.createTask(state.sessionId, "Моя задача");
    const result = await handleCommand("/task", "", state, deps);
    expect(result).toBeNull();
  });

  test("/task list показывает задачи", async () => {
    deps.taskService.createTask(state.sessionId, "Задача 1");
    deps.taskService.createTask(state.sessionId, "Задача 2");
    const result = await handleCommand("/task", "list", state, deps);
    expect(result).toBeNull();
  });

  test("/task create паузит предыдущую активную задачу", async () => {
    await handleCommand("/task", 'create "Задача 1"', state, deps);
    await handleCommand("/task", 'create "Задача 2"', state, deps);
    const tasks = deps.taskService.getSessionTasks(state.sessionId);
    expect(tasks[0].phase).toBe("paused");
    expect(tasks[1].phase).toBe("planning");
  });

  test("/task list пустой список", async () => {
    const result = await handleCommand("/task", "list", state, deps);
    expect(result).toBeNull();
  });

  test("/task cancel отменяет активную задачу", async () => {
    deps.taskService.createTask(state.sessionId, "Задача");
    await handleCommand("/task", "cancel", state, deps);
    const tasks = deps.taskService.getSessionTasks(state.sessionId);
    expect(tasks[0].phase).toBe("cancelled");
  });

  test("/task cancel без активной задачи показывает ошибку", async () => {
    const result = await handleCommand("/task", "cancel", state, deps);
    expect(result).toBeNull();
  });

  test("/task done не распознаётся как команда", async () => {
    deps.taskService.createTask(state.sessionId, "Задача");
    await handleCommand("/task", "done", state, deps);
    // Задача остаётся в planning — команда done не существует
    const tasks = deps.taskService.getSessionTasks(state.sessionId);
    expect(tasks[0].phase).toBe("planning");
  });

  test("/task pause не распознаётся как команда", async () => {
    deps.taskService.createTask(state.sessionId, "Задача");
    await handleCommand("/task", "pause", state, deps);
    const tasks = deps.taskService.getSessionTasks(state.sessionId);
    // Задача остаётся активной — команда pause не существует
    expect(tasks[0].phase).toBe("planning");
  });

  test("/task switch не распознаётся как команда", async () => {
    const result = await handleCommand("/task", "switch", state, deps);
    expect(result).toBeNull();
  });

  // Phase 6: восстановление сессии

  test("/switch паузит задачи покидаемой сессии", async () => {
    deps.taskService.createTask(state.sessionId, "Задача в старой сессии");
    const oldSessionId = state.sessionId;
    const newSessionId = deps.sessionService.createSession("new");
    await handleCommand("/switch", String(newSessionId), state, deps);
    const tasks = deps.taskService.getSessionTasks(oldSessionId);
    expect(tasks[0].phase).toBe("paused");
  });

  test("/switch показывает задачи новой сессии", async () => {
    const newSessionId = deps.sessionService.createSession("new");
    deps.taskService.createTask(newSessionId, "Задача в новой сессии");
    deps.taskService.pauseAllActive(newSessionId);
    await handleCommand("/switch", String(newSessionId), state, deps);
    // Единственная paused задача авто-resume-ится
    const active = deps.taskService.getActiveTask(newSessionId);
    expect(active).not.toBeNull();
    expect(active!.title).toBe("Задача в новой сессии");
  });

  // Task state commands (day25)

  test("/taskstate без сервиса показывает ошибку", async () => {
    const result = await handleCommand("/taskstate", "show", state, deps);
    expect(result).toBeNull();
  });

  test("/taskstate show на пустом стейте возвращает 'пусто'", async () => {
    const { TaskStateService } = await import("../../domain/services/task-state-service");
    const { SqliteTaskStateRepository } = await import("../../storage/sqlite/task-state-repository");
    deps.taskStateService = new TaskStateService(new SqliteTaskStateRepository());
    const result = await handleCommand("/taskstate", "show", state, deps);
    expect(result).toBeNull();
  });

  test("/taskstate show отображает заполненный стейт", async () => {
    const { TaskStateService } = await import("../../domain/services/task-state-service");
    const { SqliteTaskStateRepository } = await import("../../storage/sqlite/task-state-repository");
    const repo = new SqliteTaskStateRepository();
    deps.taskStateService = new TaskStateService(repo);
    repo.upsert({
      sessionId: state.sessionId,
      goal: "test goal",
      constraints: ["c1"],
      terms: {},
      openQuestions: [],
      resolvedFacts: [],
      updatedAt: "",
    });
    const result = await handleCommand("/taskstate", "show", state, deps);
    expect(result).toBeNull();
    expect(deps.taskStateService.getState(state.sessionId).goal).toBe("test goal");
  });

  test("/taskstate clear обнуляет состояние", async () => {
    const { TaskStateService } = await import("../../domain/services/task-state-service");
    const { SqliteTaskStateRepository } = await import("../../storage/sqlite/task-state-repository");
    const repo = new SqliteTaskStateRepository();
    deps.taskStateService = new TaskStateService(repo);
    repo.upsert({
      sessionId: state.sessionId,
      goal: "удалить меня",
      constraints: [],
      terms: {},
      openQuestions: [],
      resolvedFacts: [],
      updatedAt: "",
    });
    await handleCommand("/taskstate", "clear", state, deps);
    expect(deps.taskStateService.getState(state.sessionId).goal).toBeNull();
  });

  test("/taskstate show --raw выводит JSON", async () => {
    const { TaskStateService } = await import("../../domain/services/task-state-service");
    const { SqliteTaskStateRepository } = await import("../../storage/sqlite/task-state-repository");
    deps.taskStateService = new TaskStateService(new SqliteTaskStateRepository());
    const result = await handleCommand("/taskstate", "show --raw", state, deps);
    expect(result).toBeNull();
  });

  test("/taskstate неизвестная подкоманда не падает", async () => {
    const { TaskStateService } = await import("../../domain/services/task-state-service");
    const { SqliteTaskStateRepository } = await import("../../storage/sqlite/task-state-repository");
    deps.taskStateService = new TaskStateService(new SqliteTaskStateRepository());
    const result = await handleCommand("/taskstate", "nonsense", state, deps);
    expect(result).toBeNull();
  });
});
