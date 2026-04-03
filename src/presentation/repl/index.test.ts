import { describe, test, expect, beforeEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleCommand, type ReplDeps } from "./index";
import { initDb } from "../../db";

import { SqliteSessionRepository } from "../../storage/sqlite/session-repository";
import { SqliteMessageRepository } from "../../storage/sqlite/message-repository";
import { SqliteModelRepository } from "../../storage/sqlite/model-repository";
import { SqliteOptionsRepository } from "../../storage/sqlite/options-repository";
import { SqliteCheckpointRepository } from "../../storage/sqlite/checkpoint-repository";
import { SqliteProfileRepository } from "../../storage/sqlite/profile-repository";
import { SqliteInvariantRepository } from "../../storage/sqlite/invariant-repository";

import { SessionService } from "../../domain/services/session-service";
import { CostService } from "../../domain/services/cost-service";
import { ChatService } from "../../domain/services/chat-service";
import { ProfileService } from "../../domain/services/profile-service";
import { InvariantService } from "../../domain/services/invariant-service";
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
  let state: { sessionId: number };

  beforeEach(() => {
    const dbPath = freshDb();

    const sessionRepo = new SqliteSessionRepository();
    const messageRepo = new SqliteMessageRepository();
    const modelRepo = new SqliteModelRepository();
    const optionsRepo = new SqliteOptionsRepository();
    const checkpointRepo = new SqliteCheckpointRepository();
    const profileRepo = new SqliteProfileRepository();
    const invariantRepo = new SqliteInvariantRepository();
    const llmClient = createMockLLMClient();

    const sessionService = new SessionService(sessionRepo, messageRepo);
    const costService = new CostService(modelRepo);
    const profileService = new ProfileService(profileRepo, optionsRepo);
    const invariantService = new InvariantService(invariantRepo);
    const chatService = new ChatService(llmClient, sessionService, costService, messageRepo, modelRepo, profileService, invariantService);

    deps = {
      config: createTestConfig(),
      sessionService,
      chatService,
      costService,
      modelRepo,
      optionsRepo,
      checkpointRepo,
      llmClient,
      openaiClient: {} as any,
      profileService,
      invariantService,
    };

    const id = sessionService.createSession(undefined, "full");
    state = { sessionId: id };
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
    await handleCommand("/set", "custom_key 10", state, deps);
    expect(deps.optionsRepo.get("custom_key")).toBe("10");
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

  // Invariant commands

  test("/invariant without profile shows error", async () => {
    const result = await handleCommand("/invariant", "", state, deps);
    expect(result).toBeNull();
  });

  test("/invariant add creates invariant", async () => {
    const id = deps.profileService.createProfile("test");
    deps.profileService.setActiveProfile(id);
    await handleCommand("/invariant", "add Только TypeScript", state, deps);
    const invariants = deps.invariantService.getByProfile(id);
    expect(invariants).toHaveLength(1);
    expect(invariants[0].content).toBe("Только TypeScript");
  });

  test("/invariant shows list of invariants", async () => {
    const id = deps.profileService.createProfile("test");
    deps.profileService.setActiveProfile(id);
    deps.invariantService.add(id, "правило 1");
    deps.invariantService.add(id, "правило 2");
    const result = await handleCommand("/invariant", "", state, deps);
    expect(result).toBeNull();
  });

  test("/invariant delete removes invariant", async () => {
    const id = deps.profileService.createProfile("test");
    deps.profileService.setActiveProfile(id);
    const inv = deps.invariantService.add(id, "правило");
    await handleCommand("/invariant", `delete ${inv.id}`, state, deps);
    expect(deps.invariantService.getByProfile(id)).toHaveLength(0);
  });

  test("/invariant add without text shows error", async () => {
    const id = deps.profileService.createProfile("test");
    deps.profileService.setActiveProfile(id);
    await handleCommand("/invariant", "add", state, deps);
    expect(deps.invariantService.getByProfile(id)).toHaveLength(0);
  });

  test("/invariant shows empty when no invariants", async () => {
    const id = deps.profileService.createProfile("test");
    deps.profileService.setActiveProfile(id);
    const result = await handleCommand("/invariant", "", state, deps);
    expect(result).toBeNull();
  });
});
