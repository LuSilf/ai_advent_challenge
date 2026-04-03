import { describe, test, expect, beforeEach } from "bun:test";
import { ChatService } from "./chat-service";
import { CostService } from "./cost-service";
import { SessionService } from "./session-service";
import { InvariantService } from "./invariant-service";
import type { LLMClient, StreamEvent } from "../ports/llm-client";
import type { ModelRepository } from "../ports/model-repository";
import type { SessionRepository } from "../ports/session-repository";
import type { MessageRepository } from "../ports/message-repository";
import type { InvariantRepository } from "../ports/invariant-repository";
import type { LLMRequest, LLMResponse, Message, Model, Session, Invariant } from "../models";

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
      return { content: responseText, inputTokens: 100, outputTokens: 50 };
    },
    async *stream(request: LLMRequest): AsyncIterable<StreamEvent> {
      yield { type: "delta", text: responseText };
      yield { type: "done", response: { content: responseText, inputTokens: 100, outputTokens: 50 } };
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

function createMockInvariantRepo(): InvariantRepository {
  const invariants: Invariant[] = [];
  let nextId = 1;
  return {
    add(content) {
      const id = nextId++;
      invariants.push({ id, content, createdAt: "" });
      return id;
    },
    getAll() { return [...invariants]; },
    delete(id) {
      const idx = invariants.findIndex((i) => i.id === id);
      if (idx === -1) return false;
      invariants.splice(idx, 1);
      return true;
    },
  };
}

describe("ChatService", () => {
  let chatService: ChatService;
  let sessionService: SessionService;
  let msgRepo: MessageRepository;

  beforeEach(() => {
    const modelRepo = createMockModelRepo();
    const sessionRepo = createMockSessionRepo();
    msgRepo = createMockMessageRepo();

    sessionService = new SessionService(sessionRepo, msgRepo);
    const costService = new CostService(modelRepo);

    chatService = new ChatService(
      createMockLLMClient(),
      sessionService,
      costService,
      msgRepo,
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
    const messages = msgRepo.getBySession(sessionId);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
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

  test("sendMessage streaming collects response text", async () => {
    const sessionId = sessionService.createSession();
    const result = await chatService.sendMessage(sessionId, "стрим", {
      historyLimit: 50,
      systemPrompt: "",
      useStreaming: true,
    });

    expect(result.response.content).toBe("ответ бота");
    expect(msgRepo.getBySession(sessionId)).toHaveLength(2);
  });

  test("sendMessage returns model info", async () => {
    const sessionId = sessionService.createSession();
    const result = await chatService.sendMessage(sessionId, "тест", {
      historyLimit: 50,
      systemPrompt: "",
      useStreaming: false,
    });

    expect(result.model.id).toBe("test/model");
  });

  test("sendMessage includes invariants block in instructions", async () => {
    const invariantRepo = createMockInvariantRepo();
    const invariantService = new InvariantService(invariantRepo);
    invariantService.add("Только TypeScript");
    invariantService.add("Без ORM");

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
      new CostService(modelRepo),
      newMsgRepo,
      modelRepo,
      invariantService,
    );

    const sid = sessionRepo.create();
    await svc.sendMessage(sid, "напиши на Python", {
      historyLimit: 50,
      systemPrompt: "базовый промпт",
      useStreaming: false,
    });

    expect(capturedRequest).not.toBeNull();
    expect(capturedRequest!.instructions).toContain("ИНВАРИАНТЫ");
    expect(capturedRequest!.instructions).toContain("Только TypeScript");
    expect(capturedRequest!.instructions).toContain("Без ORM");
    expect(capturedRequest!.instructions).toContain("ОТКАЖИ");
    expect(capturedRequest!.instructions).toContain("базовый промпт");
  });

  test("sendMessage does not include invariants block when empty", async () => {
    const invariantRepo = createMockInvariantRepo();
    const invariantService = new InvariantService(invariantRepo);

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
      new CostService(modelRepo),
      newMsgRepo,
      modelRepo,
      invariantService,
    );

    const sid = sessionRepo.create();
    await svc.sendMessage(sid, "привет", {
      historyLimit: 50,
      systemPrompt: "промпт",
      useStreaming: false,
    });

    expect(capturedRequest).not.toBeNull();
    expect(capturedRequest!.instructions).not.toContain("ИНВАРИАНТЫ");
  });
});
