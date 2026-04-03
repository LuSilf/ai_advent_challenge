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
import { SqliteInvariantRepository } from "../../storage/sqlite/invariant-repository";

import { SessionService } from "../../domain/services/session-service";
import { CostService } from "../../domain/services/cost-service";
import { ChatService } from "../../domain/services/chat-service";
import { InvariantService } from "../../domain/services/invariant-service";
import type { LLMClient, StreamEvent } from "../../domain/ports/llm-client";
import type { LLMResponse } from "../../domain/models";
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
    freshDb();

    const sessionRepo = new SqliteSessionRepository();
    const messageRepo = new SqliteMessageRepository();
    const modelRepo = new SqliteModelRepository();
    const optionsRepo = new SqliteOptionsRepository();
    const checkpointRepo = new SqliteCheckpointRepository();
    const invariantRepo = new SqliteInvariantRepository();
    const llmClient = createMockLLMClient();

    const sessionService = new SessionService(sessionRepo, messageRepo);
    const costService = new CostService(modelRepo);
    const invariantService = new InvariantService(invariantRepo);
    const chatService = new ChatService(llmClient, sessionService, costService, messageRepo, modelRepo, invariantService);

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

  test("/clear clears messages", async () => {
    deps.sessionService.addMessage(state.sessionId, "user", "test");
    await handleCommand("/clear", "", state, deps);
    expect(deps.sessionService.getHistory(state.sessionId)).toHaveLength(0);
  });

  test("/delete removes session", async () => {
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
    expect(await handleCommand("/models", "", state, deps)).toBeNull();
  });

  test("/roles shows roles", async () => {
    expect(await handleCommand("/roles", "", state, deps)).toBeNull();
  });

  test("/set_model changes role", async () => {
    await handleCommand("/set_model", "chat deepseek/deepseek-v3.2", state, deps);
    expect(deps.modelRepo.getRole("chat")!.id).toBe("deepseek/deepseek-v3.2");
  });

  test("/set changes option", async () => {
    await handleCommand("/set", "custom_key 10", state, deps);
    expect(deps.optionsRepo.get("custom_key")).toBe("10");
  });

  test("/help returns null", async () => {
    expect(await handleCommand("/help", "", state, deps)).toBeNull();
  });

  test("unknown command returns null", async () => {
    expect(await handleCommand("/unknown", "", state, deps)).toBeNull();
  });

  test("/checkpoint and /branch work", async () => {
    deps.sessionService.addMessage(state.sessionId, "user", "msg1");
    deps.sessionService.addMessage(state.sessionId, "assistant", "msg2");
    await handleCommand("/checkpoint", "", state, deps);
    const oldId = state.sessionId;
    await handleCommand("/branch", "my-branch", state, deps);
    expect(state.sessionId).not.toBe(oldId);
  });

  // Invariant commands

  test("/invariant add creates invariant", async () => {
    await handleCommand("/invariant", "add Только TypeScript", state, deps);
    const invariants = deps.invariantService.getAll();
    expect(invariants).toHaveLength(1);
    expect(invariants[0].content).toBe("Только TypeScript");
  });

  test("/invariant shows list", async () => {
    deps.invariantService.add("правило 1");
    deps.invariantService.add("правило 2");
    expect(await handleCommand("/invariant", "", state, deps)).toBeNull();
  });

  test("/invariant delete removes invariant", async () => {
    const inv = deps.invariantService.add("правило");
    await handleCommand("/invariant", `delete ${inv.id}`, state, deps);
    expect(deps.invariantService.getAll()).toHaveLength(0);
  });

  test("/invariant add without text shows error", async () => {
    await handleCommand("/invariant", "add", state, deps);
    expect(deps.invariantService.getAll()).toHaveLength(0);
  });

  test("/invariant shows empty when no invariants", async () => {
    expect(await handleCommand("/invariant", "", state, deps)).toBeNull();
  });
});
