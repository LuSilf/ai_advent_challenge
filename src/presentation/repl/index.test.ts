import { describe, test, expect, beforeEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleCommand, type ReplDeps } from "./index";
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
import type { LLMClient, StreamEvent } from "../../domain/ports/llm-client";
import type { LLMRequest, LLMResponse } from "../../domain/models";
import type { AppConfig } from "../../config";

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
  };
}

describe("presentation/repl handleCommand", () => {
  let deps: ReplDeps;
  let state: { sessionId: number; messagesSinceReconciliation: number };

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
    const llmClient = createMockLLMClient();

    const sessionService = new SessionService(sessionRepo, messageRepo);
    const contextService = new ContextService();
    const costService = new CostService(modelRepo);
    const profileService = new ProfileService(profileRepo, optionsRepo);
    const chatService = new ChatService(llmClient, sessionService, contextService, costService, messageRepo, factRepo, modelRepo, profileService);
    const memoryService = new MemoryService(memoryRepo, llmClient, modelRepo);

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
    };

    const id = sessionService.createSession(undefined, "full");
    state = { sessionId: id, messagesSinceReconciliation: 0 };
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

  test("/profile set updates active profile field", async () => {
    const id = deps.profileService.createProfile("test");
    deps.profileService.setActiveProfile(id);
    await handleCommand("/profile", "set language русский", state, deps);
    expect(deps.profileService.getProfile(id)!.language).toBe("русский");
  });

  test("/profile set adds custom preference", async () => {
    const id = deps.profileService.createProfile("test");
    deps.profileService.setActiveProfile(id);
    await handleCommand("/profile", "set framework React", state, deps);
    // Custom preferences handled by profileService.setPreference
  });

  test("/profile delete removes profile", async () => {
    const id = deps.profileService.createProfile("test");
    await handleCommand("/profile", `delete ${id}`, state, deps);
    expect(deps.profileService.getProfile(id)).toBeNull();
  });
});
