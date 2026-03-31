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
import type { LLMRequest, LLMResponse, Message, Model, Fact, Session } from "../models";

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
});
