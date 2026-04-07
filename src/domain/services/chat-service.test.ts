import { describe, test, expect, beforeEach } from "bun:test";
import { ChatService } from "./chat-service";
import { ContextService } from "./context-service";
import { CostService } from "./cost-service";
import { SessionService } from "./session-service";
import type { LLMClient, StreamEvent } from "../ports/llm-client";
import type { ModelRepository } from "../ports/model-repository";
import type { SessionRepository } from "../ports/session-repository";
import type { MessageRepository } from "../ports/message-repository";
import type { FactRepository } from "../ports/fact-repository";
import type { ProfileRepository } from "../ports/profile-repository";
import type { OptionsRepository } from "../ports/options-repository";
import { ProfileService } from "./profile-service";
import type { LLMRequest, LLMResponse, LLMToolCall, Message, Model, Fact, Session, Profile, ProfilePreference } from "../models";
import type { ToolProvider, ToolCallEvent } from "./chat-service";

const testModel: Model = {
  id: "test/model",
  name: "Test Model",
  inputPrice: 0.10,
  outputPrice: 0.40,
  contextSize: 100_000,
};

function createMockLLMClient(responseText = "ответ бота"): LLMClient {
  return {
    async send(request: LLMRequest): Promise<LLMResponse & { rawResponse?: unknown }> {
      return {
        content: responseText,
        inputTokens: 100,
        outputTokens: 50,
      };
    },
    async *stream(request: LLMRequest): AsyncIterable<StreamEvent> {
      yield { type: "delta", text: responseText };
      yield {
        type: "done",
        response: { content: responseText, inputTokens: 100, outputTokens: 50 },
      };
    },
  };
}

function createMockModelRepo(): ModelRepository {
  return {
    getAll: () => [testModel],
    getById: (id) => (id === testModel.id ? testModel : null),
    getRole: () => testModel,
    getRoles: () => [{ role: "chat", modelId: testModel.id, modelName: testModel.name }],
    setRole: () => {},
  };
}

function createMockSessionRepo(): SessionRepository {
  const sessions = new Map<number, Session>();
  let nextId = 1;
  return {
    create(title?, contextStrategy?) {
      const id = nextId++;
      const now = new Date().toISOString();
      sessions.set(id, { id, title: title ?? null, contextStrategy: contextStrategy ?? "full", parentSessionId: null, branchPointMessageId: null, createdAt: now, updatedAt: now });
      return id;
    },
    getById: (id) => sessions.get(id) ?? null,
    getAll: () => [],
    update: () => {},
    delete: () => true,
    getLastSession: () => null,
    getStrategy: (id) => sessions.get(id)?.contextStrategy ?? "full",
    setStrategy: () => {},
    updateTitle: (id, title) => { const s = sessions.get(id); if (s) s.title = title; },
    updateTitleIfNull: (id, title) => { const s = sessions.get(id); if (s && !s.title) s.title = title; },
    createBranch: () => nextId++,
    getBranches: () => [],
  };
}

function createMockMessageRepo(): MessageRepository {
  const messages: Message[] = [];
  let nextId = 1;
  return {
    add(sessionId, role, content) {
      messages.push({ id: nextId++, sessionId, role, content, createdAt: new Date().toISOString() });
    },
    getBySession(sessionId, limit?) {
      const filtered = messages.filter((m) => m.sessionId === sessionId);
      if (limit) return filtered.slice(-limit);
      return filtered;
    },
    getCount: (sessionId) => messages.filter((m) => m.sessionId === sessionId).length,
    deleteBySession: (sessionId) => {
      const indices = messages.map((m, i) => m.sessionId === sessionId ? i : -1).filter((i) => i >= 0).reverse();
      for (const i of indices) messages.splice(i, 1);
    },
  };
}

function createMockFactRepo(): FactRepository {
  const facts = new Map<number, Fact[]>();
  return {
    getBySession: (id) => facts.get(id) ?? [],
    set: (id, f) => facts.set(id, f),
    delete: (id) => { facts.delete(id); },
  };
}

function createMockProfileRepo(): ProfileRepository {
  const profiles = new Map<number, Profile>();
  const preferences = new Map<number, Map<string, string>>();
  let nextId = 1;
  return {
    create(data) {
      const id = nextId++;
      const now = new Date().toISOString();
      profiles.set(id, { id, ...data, createdAt: now, updatedAt: now });
      return id;
    },
    getById: (id) => profiles.get(id) ?? null,
    getAll: () => [...profiles.values()],
    update(id, fields) {
      const p = profiles.get(id);
      if (p) Object.assign(p, fields);
    },
    delete(id) { preferences.delete(id); return profiles.delete(id); },
    getPreferences(profileId) {
      const map = preferences.get(profileId);
      if (!map) return [];
      return [...map.entries()].map(([key, value]) => ({ key, value }));
    },
    setPreference(profileId, key, value) {
      if (!preferences.has(profileId)) preferences.set(profileId, new Map());
      preferences.get(profileId)!.set(key, value);
    },
    deletePreference(profileId, key) {
      return preferences.get(profileId)?.delete(key) ?? false;
    },
  };
}

function createMockOptionsRepo(): OptionsRepository {
  const options = new Map<string, string>();
  return {
    get: (key) => options.get(key) ?? null,
    set: (key, value) => { options.set(key, value); },
    getAll: () => [...options.entries()].map(([key, value]) => ({ key, value })),
  };
}

describe("ChatService", () => {
  let chatService: ChatService;
  let sessionService: SessionService;
  let msgRepo: MessageRepository;
  let factRepo: FactRepository;
  let llmClient: LLMClient;

  beforeEach(() => {
    const modelRepo = createMockModelRepo();
    const sessionRepo = createMockSessionRepo();
    msgRepo = createMockMessageRepo();
    factRepo = createMockFactRepo();
    llmClient = createMockLLMClient();

    sessionService = new SessionService(sessionRepo, msgRepo);
    const contextService = new ContextService();
    const costService = new CostService(modelRepo);

    chatService = new ChatService(
      llmClient,
      sessionService,
      contextService,
      costService,
      msgRepo,
      factRepo,
      modelRepo,
    );
  });

  test("sendMessage saves user and assistant messages", async () => {
    const sessionId = sessionService.createSession();
    const result = await chatService.sendMessage(sessionId, "привет", {
      historyLimit: 50,
      systemPrompt: "test",
      useStreaming: false,
    });

    expect(result.response.content).toBe("ответ бота");
    // user + assistant messages saved
    const messages = msgRepo.getBySession(sessionId);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("привет");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toBe("ответ бота");
  });

  test("sendMessage returns cost info", async () => {
    const sessionId = sessionService.createSession();
    const result = await chatService.sendMessage(sessionId, "тест", {
      historyLimit: 50,
      systemPrompt: "",
      useStreaming: false,
    });

    expect(result.costInfo).toBeDefined();
    expect(result.costInfo!.inputTokens).toBe(100);
    expect(result.costInfo!.outputTokens).toBe(50);
  });

  test("sendMessage uses context from history", async () => {
    const sessionId = sessionService.createSession();
    msgRepo.add(sessionId, "user", "предыдущий вопрос");
    msgRepo.add(sessionId, "assistant", "предыдущий ответ");

    let capturedRequest: LLMRequest | null = null;
    const capturingClient: LLMClient = {
      async send(request) {
        capturedRequest = request;
        return { content: "ok", inputTokens: 10, outputTokens: 5 };
      },
      async *stream() {
        yield { type: "done" as const, response: { content: "ok", inputTokens: 10, outputTokens: 5 } };
      },
    };

    const modelRepo = createMockModelRepo();
    const sessionRepo = createMockSessionRepo();
    const newSessionService = new SessionService(sessionRepo, msgRepo);
    // Recreate session in this repo
    const sid = sessionRepo.create();

    const svc = new ChatService(
      capturingClient,
      newSessionService,
      new ContextService(),
      new CostService(modelRepo),
      msgRepo,
      factRepo,
      modelRepo,
    );

    // Add history to the new session
    msgRepo.add(sid, "user", "prev");
    msgRepo.add(sid, "assistant", "prev answer");

    await svc.sendMessage(sid, "новый вопрос", {
      historyLimit: 50,
      systemPrompt: "sys",
      useStreaming: false,
    });

    expect(capturedRequest).not.toBeNull();
    // Context should include previous messages + new user message
    expect(capturedRequest!.messages.length).toBeGreaterThanOrEqual(2);
  });

  test("sendMessage streaming collects response text", async () => {
    const sessionId = sessionService.createSession();
    const result = await chatService.sendMessage(sessionId, "стрим", {
      historyLimit: 50,
      systemPrompt: "",
      useStreaming: true,
    });

    expect(result.response.content).toBe("ответ бота");
    const messages = msgRepo.getBySession(sessionId);
    expect(messages).toHaveLength(2);
  });

  test("sendMessage returns model info", async () => {
    const sessionId = sessionService.createSession();
    const result = await chatService.sendMessage(sessionId, "тест", {
      historyLimit: 50,
      systemPrompt: "",
      useStreaming: false,
    });

    expect(result.model).toBeDefined();
    expect(result.model.id).toBe("test/model");
  });

  test("sendMessage includes profile block in instructions when profile is active", async () => {
    const profileRepo = createMockProfileRepo();
    const optionsRepo = createMockOptionsRepo();
    const profileService = new ProfileService(profileRepo, optionsRepo);

    const profileId = profileService.createProfile("dev", {
      userName: "Алексей",
      language: "русский",
      style: "неформальный",
    });
    profileService.setActiveProfile(profileId);

    let capturedRequest: LLMRequest | null = null;
    const capturingClient: LLMClient = {
      async send(request) {
        capturedRequest = request;
        return { content: "ok", inputTokens: 10, outputTokens: 5 };
      },
      async *stream() {
        yield { type: "done" as const, response: { content: "ok", inputTokens: 10, outputTokens: 5 } };
      },
    };

    const modelRepo = createMockModelRepo();
    const sessionRepo = createMockSessionRepo();
    const newMsgRepo = createMockMessageRepo();
    const svc = new ChatService(
      capturingClient,
      new SessionService(sessionRepo, newMsgRepo),
      new ContextService(),
      new CostService(modelRepo),
      newMsgRepo,
      createMockFactRepo(),
      modelRepo,
      profileService,
    );

    const sid = sessionRepo.create();
    await svc.sendMessage(sid, "привет", {
      historyLimit: 50,
      systemPrompt: "базовый промпт",
      useStreaming: false,
    });

    expect(capturedRequest).not.toBeNull();
    expect(capturedRequest!.instructions).toContain("Профиль пользователя");
    expect(capturedRequest!.instructions).toContain("Алексей");
    expect(capturedRequest!.instructions).toContain("русский");
    expect(capturedRequest!.instructions).toContain("базовый промпт");
  });

  test("sendMessage works without profileService", async () => {
    const sessionId = sessionService.createSession();
    const result = await chatService.sendMessage(sessionId, "без профиля", {
      historyLimit: 50,
      systemPrompt: "test",
      useStreaming: false,
    });

    expect(result.response.content).toBe("ответ бота");
  });
});

// --- Tool-use loop tests ---

function createToolUseLLMClient(responses: Array<{ content: string; toolCalls?: LLMToolCall[] }>): LLMClient {
  let callIndex = 0;
  return {
    async send(): Promise<LLMResponse & { rawResponse?: unknown }> {
      const resp = responses[callIndex++] ?? { content: "fallback", toolCalls: undefined };
      return {
        content: resp.content,
        inputTokens: 10,
        outputTokens: 5,
        toolCalls: resp.toolCalls,
      };
    },
    async *stream(): AsyncIterable<StreamEvent> {
      const resp = responses[callIndex++] ?? { content: "fallback" };
      yield { type: "done", response: { content: resp.content, inputTokens: 10, outputTokens: 5 } };
    },
  };
}

function createMockToolProvider(results: Record<string, { content: string; isError: boolean }>): ToolProvider {
  return {
    getToolDefinitions: () => [
      { name: "server__tool_a", description: "Tool A", parameters: {} },
      { name: "server__tool_b", description: "Tool B", parameters: {} },
    ],
    callTool: async (name, args) => {
      return results[name] ?? { content: "unknown tool", isError: true };
    },
  };
}

describe("ChatService tool-use loop", () => {
  function buildServiceWithClient(client: LLMClient) {
    const modelRepo = createMockModelRepo();
    const sessionRepo = createMockSessionRepo();
    const msgRepo = createMockMessageRepo();
    const factRepo = createMockFactRepo();
    const sessionService = new SessionService(sessionRepo, msgRepo);
    const contextService = new ContextService();
    const costService = new CostService(modelRepo);

    const chatService = new ChatService(
      client,
      sessionService,
      contextService,
      costService,
      msgRepo,
      factRepo,
      modelRepo,
    );

    const sessionId = sessionRepo.create();
    return { chatService, sessionId, msgRepo };
  }

  test("single tool call → result → final answer", async () => {
    const client = createToolUseLLMClient([
      // Round 1: LLM requests tool call
      {
        content: "",
        toolCalls: [{ id: "call_1", name: "server__tool_a", arguments: '{"x": 1}' }],
      },
      // Round 2: LLM gives final answer
      { content: "Результат: 42" },
    ]);

    const toolProvider = createMockToolProvider({
      "server__tool_a": { content: "42", isError: false },
    });

    const { chatService, sessionId } = buildServiceWithClient(client);
    const result = await chatService.sendMessage(sessionId, "тест", {
      historyLimit: 50,
      systemPrompt: "",
      useStreaming: false,
      toolProvider,
    });

    expect(result.response.content).toBe("Результат: 42");
  });

  test("chain: tool A → tool B → final answer", async () => {
    const client = createToolUseLLMClient([
      // Round 1: call tool A
      {
        content: "",
        toolCalls: [{ id: "call_1", name: "server__tool_a", arguments: "{}" }],
      },
      // Round 2: call tool B
      {
        content: "",
        toolCalls: [{ id: "call_2", name: "server__tool_b", arguments: "{}" }],
      },
      // Round 3: final answer
      { content: "Готово" },
    ]);

    const toolProvider = createMockToolProvider({
      "server__tool_a": { content: "data_a", isError: false },
      "server__tool_b": { content: "data_b", isError: false },
    });

    const { chatService, sessionId } = buildServiceWithClient(client);
    const result = await chatService.sendMessage(sessionId, "цепочка", {
      historyLimit: 50,
      systemPrompt: "",
      useStreaming: false,
      toolProvider,
    });

    expect(result.response.content).toBe("Готово");
  });

  test("no tool calls — normal text response", async () => {
    const client = createToolUseLLMClient([
      { content: "обычный ответ" },
    ]);

    const toolProvider = createMockToolProvider({});

    const { chatService, sessionId } = buildServiceWithClient(client);
    const result = await chatService.sendMessage(sessionId, "вопрос", {
      historyLimit: 50,
      systemPrompt: "",
      useStreaming: false,
      toolProvider,
    });

    expect(result.response.content).toBe("обычный ответ");
  });

  test("tool error is passed back to LLM", async () => {
    const client = createToolUseLLMClient([
      {
        content: "",
        toolCalls: [{ id: "call_1", name: "server__tool_a", arguments: "{}" }],
      },
      { content: "Произошла ошибка при вызове инструмента" },
    ]);

    const toolProvider = createMockToolProvider({
      "server__tool_a": { content: "server error", isError: true },
    });

    const { chatService, sessionId } = buildServiceWithClient(client);
    const result = await chatService.sendMessage(sessionId, "ошибка", {
      historyLimit: 50,
      systemPrompt: "",
      useStreaming: false,
      toolProvider,
    });

    expect(result.response.content).toBe("Произошла ошибка при вызове инструмента");
  });

  test("max rounds limit prevents infinite loops", async () => {
    // maxToolRounds=3: 3 rounds of tool calls, then a forced final request without tools
    // So we need 3 tool-call responses + 1 final text response = 4 LLM calls
    const responses = [
      { content: "", toolCalls: [{ id: "c1", name: "server__tool_a", arguments: "{}" }] as LLMToolCall[] },
      { content: "", toolCalls: [{ id: "c2", name: "server__tool_a", arguments: "{}" }] as LLMToolCall[] },
      { content: "", toolCalls: [{ id: "c3", name: "server__tool_a", arguments: "{}" }] as LLMToolCall[] },
      { content: "Лимит достигнут" },
    ];

    const client = createToolUseLLMClient(responses);
    const toolProvider = createMockToolProvider({
      "server__tool_a": { content: "ok", isError: false },
    });

    const { chatService, sessionId } = buildServiceWithClient(client);
    const result = await chatService.sendMessage(sessionId, "бесконечность", {
      historyLimit: 50,
      systemPrompt: "",
      useStreaming: false,
      toolProvider,
      maxToolRounds: 3,
    });

    expect(result.response.content).toBe("Лимит достигнут");
  });

  test("onToolCall callback is invoked for each tool call", async () => {
    const client = createToolUseLLMClient([
      {
        content: "",
        toolCalls: [{ id: "call_1", name: "server__tool_a", arguments: '{"x": 1}' }],
      },
      { content: "done" },
    ]);

    const toolProvider = createMockToolProvider({
      "server__tool_a": { content: "result", isError: false },
    });

    const events: ToolCallEvent[] = [];
    const { chatService, sessionId } = buildServiceWithClient(client);

    await chatService.sendMessage(sessionId, "test", {
      historyLimit: 50,
      systemPrompt: "",
      useStreaming: false,
      toolProvider,
      onToolCall: (event) => events.push(event),
    });

    // Two events: one before call (no result), one after call (with result)
    expect(events.length).toBe(2);
    expect(events[0].toolName).toBe("server__tool_a");
    expect(events[0].result).toBeUndefined();
    expect(events[1].result).toBe("result");
  });

  test("tool-use aggregates token counts across rounds", async () => {
    const client = createToolUseLLMClient([
      {
        content: "",
        toolCalls: [{ id: "call_1", name: "server__tool_a", arguments: "{}" }],
      },
      { content: "done" },
    ]);

    const toolProvider = createMockToolProvider({
      "server__tool_a": { content: "ok", isError: false },
    });

    const { chatService, sessionId } = buildServiceWithClient(client);
    const result = await chatService.sendMessage(sessionId, "test", {
      historyLimit: 50,
      systemPrompt: "",
      useStreaming: false,
      toolProvider,
    });

    // 2 rounds × 10 input + 2 rounds × 5 output
    expect(result.response.inputTokens).toBe(20);
    expect(result.response.outputTokens).toBe(10);
  });

  test("saves only final response to message repo, not intermediate tool calls", async () => {
    const client = createToolUseLLMClient([
      {
        content: "",
        toolCalls: [{ id: "call_1", name: "server__tool_a", arguments: "{}" }],
      },
      { content: "финальный ответ" },
    ]);

    const toolProvider = createMockToolProvider({
      "server__tool_a": { content: "ok", isError: false },
    });

    const { chatService, sessionId, msgRepo } = buildServiceWithClient(client);
    await chatService.sendMessage(sessionId, "test", {
      historyLimit: 50,
      systemPrompt: "",
      useStreaming: false,
      toolProvider,
    });

    const messages = msgRepo.getBySession(sessionId);
    // user message + assistant final response
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toBe("финальный ответ");
  });
});
