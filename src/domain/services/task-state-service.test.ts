import { describe, test, expect, beforeEach } from "bun:test";
import { TaskStateService } from "./task-state-service";
import type { TaskStateRepository } from "../ports/task-state-repository";
import type { LLMClient, StreamEvent } from "../ports/llm-client";
import type { ModelRepository } from "../ports/model-repository";
import type { LLMResponse, Model } from "../models";
import { createEmptyTaskState, type TaskState } from "../models/task-state";

const testModel: Model = {
  id: "test/facts-model",
  name: "Facts Model",
  inputPrice: 0.10,
  outputPrice: 0.40,
  contextSize: 100_000,
};

class InMemoryTaskStateRepository implements TaskStateRepository {
  store = new Map<number, TaskState>();

  get(sessionId: number): TaskState {
    return this.store.get(sessionId) ?? createEmptyTaskState(sessionId);
  }

  upsert(state: TaskState): void {
    const withTs = { ...state, updatedAt: new Date().toISOString() };
    this.store.set(state.sessionId, withTs);
  }

  clear(sessionId: number): void {
    this.store.delete(sessionId);
  }
}

type QueuedResponse = string | Error;

function createQueuedLLMClient(queue: QueuedResponse[]): LLMClient & { requests: string[] } {
  const requests: string[] = [];
  return {
    requests,
    async send(request): Promise<LLMResponse & { rawResponse?: unknown }> {
      requests.push(request.messages[0]?.content ?? "");
      const next = queue.shift();
      if (next === undefined) throw new Error("mock LLM: queue empty");
      if (next instanceof Error) throw next;
      return { content: next, inputTokens: 50, outputTokens: 25 };
    },
    async *stream(): AsyncIterable<StreamEvent> {
      yield { type: "done", response: { content: "", inputTokens: 0, outputTokens: 0 } };
    },
  };
}

function mockModelRepo(): ModelRepository {
  return {
    getAll: () => [testModel],
    getById: () => testModel,
    getRole: () => testModel,
    getRoles: () => [{ role: "facts", modelId: testModel.id, modelName: testModel.name }],
    setRole: () => {},
  };
}

describe("TaskStateService basic", () => {
  let repo: InMemoryTaskStateRepository;
  let service: TaskStateService;

  beforeEach(() => {
    repo = new InMemoryTaskStateRepository();
    service = new TaskStateService(repo);
  });

  test("getState returns empty state for new session", () => {
    expect(service.getState(1)).toEqual(createEmptyTaskState(1));
  });

  test("upsert + getState round-trips", () => {
    service.upsert({
      sessionId: 1,
      goal: "цель",
      constraints: ["c1"],
      terms: { t: "v" },
      openQuestions: ["q"],
      resolvedFacts: ["f"],
      updatedAt: "",
    });
    const loaded = service.getState(1);
    expect(loaded.goal).toBe("цель");
    expect(loaded.constraints).toEqual(["c1"]);
  });

  test("clear removes state for session", () => {
    service.upsert({
      sessionId: 1,
      goal: "цель",
      constraints: [],
      terms: {},
      openQuestions: [],
      resolvedFacts: [],
      updatedAt: "",
    });
    service.clear(1);
    expect(service.getState(1)).toEqual(createEmptyTaskState(1));
  });
});

describe("TaskStateService.formatForDisplay", () => {
  const service = new TaskStateService(new InMemoryTaskStateRepository());

  test("placeholder for empty state", () => {
    expect(service.formatForDisplay(createEmptyTaskState(1))).toBe("Состояние задачи пустое.");
  });

  test("renders all fields", () => {
    const state: TaskState = {
      sessionId: 1,
      goal: "горизонтально масштабировать RDBMS",
      constraints: ["только open source"],
      terms: { "репликация": "master-slave" },
      openQuestions: ["что с join?"],
      resolvedFacts: ["шардирование уменьшает нагрузку"],
      updatedAt: "2026-04-19 12:00:00",
    };
    const out = service.formatForDisplay(state);
    expect(out).toContain("Цель: горизонтально масштабировать RDBMS");
    expect(out).toContain("только open source");
    expect(out).toContain("репликация → master-slave");
    expect(out).toContain("что с join?");
    expect(out).toContain("шардирование уменьшает нагрузку");
    expect(out).toContain("(обновлено: 2026-04-19 12:00:00)");
  });
});

describe("TaskStateService.formatForPrompt", () => {
  const service = new TaskStateService(new InMemoryTaskStateRepository());

  test("returns null for empty state", () => {
    expect(service.formatForPrompt(createEmptyTaskState(1))).toBeNull();
  });

  test("compact block with filled state", () => {
    const state: TaskState = {
      sessionId: 1,
      goal: "выбрать cache",
      constraints: ["read-heavy"],
      terms: { "write-through": "кэш+БД синхронно" },
      openQuestions: [],
      resolvedFacts: [],
      updatedAt: "",
    };
    const out = service.formatForPrompt(state)!;
    expect(out.startsWith("[Состояние задачи]")).toBe(true);
    expect(out).toContain("Цель: выбрать cache");
    expect(out).toContain("Ограничения: read-heavy");
    expect(out).toContain("write-through=кэш+БД синхронно");
  });

  test("omits empty sections", () => {
    const state: TaskState = {
      sessionId: 1,
      goal: null,
      constraints: ["c"],
      terms: {},
      openQuestions: [],
      resolvedFacts: [],
      updatedAt: "",
    };
    const out = service.formatForPrompt(state)!;
    expect(out).not.toContain("Цель:");
    expect(out).not.toContain("Термины:");
    expect(out).not.toContain("Открытые вопросы:");
    expect(out).toContain("Ограничения: c");
  });
});

describe("TaskStateService.formatForRawDisplay", () => {
  const service = new TaskStateService(new InMemoryTaskStateRepository());

  test("returns valid JSON", () => {
    const state: TaskState = {
      sessionId: 1,
      goal: "X",
      constraints: [],
      terms: {},
      openQuestions: [],
      resolvedFacts: [],
      updatedAt: "",
    };
    const out = service.formatForRawDisplay(state);
    expect(() => JSON.parse(out)).not.toThrow();
    expect(JSON.parse(out).goal).toBe("X");
  });
});

describe("TaskStateService.reconcile", () => {
  let repo: InMemoryTaskStateRepository;
  let modelRepo: ModelRepository;

  beforeEach(() => {
    repo = new InMemoryTaskStateRepository();
    modelRepo = mockModelRepo();
  });

  test("fills goal from empty state on explicit formulation", async () => {
    const llm = createQueuedLLMClient([
      JSON.stringify({
        goal: "горизонтально масштабировать RDBMS",
        constraints: [],
        terms: [],
        openQuestions: [],
        resolvedFacts: [],
      }),
    ]);
    const service = new TaskStateService(repo, llm, modelRepo);

    const result = await service.reconcile(1, "хочу масштабировать RDBMS горизонтально", "ответ");
    expect(result.changed).toBe(true);
    expect(result.state.goal).toBe("горизонтально масштабировать RDBMS");
    expect(result.inputTokens).toBe(50);
    expect(result.outputTokens).toBe(25);
    expect(result.error).toBeUndefined();
    expect(repo.get(1).goal).toBe("горизонтально масштабировать RDBMS");
  });

  test("retains existing constraint even when LLM returns empty list", async () => {
    repo.upsert({
      sessionId: 1,
      goal: "цель",
      constraints: ["только open source"],
      terms: {},
      openQuestions: [],
      resolvedFacts: [],
      updatedAt: "",
    });

    const llm = createQueuedLLMClient([
      JSON.stringify({
        goal: "цель",
        constraints: [],
        terms: [],
        openQuestions: [],
        resolvedFacts: [],
      }),
    ]);
    const service = new TaskStateService(repo, llm, modelRepo);

    const result = await service.reconcile(1, "что с индексами?", "ответ");
    expect(result.state.constraints).toContain("только open source");
  });

  test("adds new constraint and preserves old one", async () => {
    repo.upsert({
      sessionId: 1,
      goal: "цель",
      constraints: ["только open source"],
      terms: {},
      openQuestions: [],
      resolvedFacts: [],
      updatedAt: "",
    });

    const llm = createQueuedLLMClient([
      JSON.stringify({
        goal: "цель",
        constraints: ["только open source", "read-heavy"],
        terms: [],
        openQuestions: [],
        resolvedFacts: [],
      }),
    ]);
    const service = new TaskStateService(repo, llm, modelRepo);

    const result = await service.reconcile(1, "нагрузка в основном read-heavy", "ответ");
    expect(result.state.constraints).toContain("только open source");
    expect(result.state.constraints).toContain("read-heavy");
    expect(result.changed).toBe(true);
  });

  test("openQuestions can be cleared (not union)", async () => {
    repo.upsert({
      sessionId: 1,
      goal: "цель",
      constraints: [],
      terms: {},
      openQuestions: ["старый вопрос"],
      resolvedFacts: [],
      updatedAt: "",
    });

    const llm = createQueuedLLMClient([
      JSON.stringify({
        goal: "цель",
        constraints: [],
        terms: [],
        openQuestions: [],
        resolvedFacts: [],
      }),
    ]);
    const service = new TaskStateService(repo, llm, modelRepo);

    const result = await service.reconcile(1, "вот ответ на старый вопрос", "ответ");
    expect(result.state.openQuestions).toEqual([]);
  });

  test("graceful failure on LLM error keeps old state", async () => {
    repo.upsert({
      sessionId: 1,
      goal: "старая цель",
      constraints: ["c1"],
      terms: {},
      openQuestions: [],
      resolvedFacts: [],
      updatedAt: "",
    });

    const llm = createQueuedLLMClient([new Error("taimaut")]);
    const service = new TaskStateService(repo, llm, modelRepo);

    const result = await service.reconcile(1, "вопрос", "ответ");
    expect(result.changed).toBe(false);
    expect(result.state.goal).toBe("старая цель");
    expect(result.state.constraints).toContain("c1");
    expect(result.error).toContain("taimaut");
  });

  test("graceful failure on invalid JSON keeps old state", async () => {
    repo.upsert({
      sessionId: 1,
      goal: "старая цель",
      constraints: [],
      terms: {},
      openQuestions: [],
      resolvedFacts: [],
      updatedAt: "",
    });

    const llm = createQueuedLLMClient(["this is not json at all"]);
    const service = new TaskStateService(repo, llm, modelRepo);

    const result = await service.reconcile(1, "вопрос", "ответ");
    expect(result.changed).toBe(false);
    expect(result.state.goal).toBe("старая цель");
    expect(result.error).toBeDefined();
  });

  test("idempotent on repeated identical payload", async () => {
    const payload = JSON.stringify({
      goal: "цель",
      constraints: ["c1"],
      terms: [],
      openQuestions: [],
      resolvedFacts: [],
    });
    const llm = createQueuedLLMClient([payload, payload]);
    const service = new TaskStateService(repo, llm, modelRepo);

    const first = await service.reconcile(1, "q", "a");
    const second = await service.reconcile(1, "q", "a");

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.state.goal).toBe("цель");
    expect(second.state.constraints).toEqual(["c1"]);
  });

  test("merges terms without dropping previously agreed ones", async () => {
    repo.upsert({
      sessionId: 1,
      goal: "цель",
      constraints: [],
      terms: { "X": "определение-1" },
      openQuestions: [],
      resolvedFacts: [],
      updatedAt: "",
    });

    const llm = createQueuedLLMClient([
      JSON.stringify({
        goal: "цель",
        constraints: [],
        terms: [{ key: "Y", value: "определение-2" }],
        openQuestions: [],
        resolvedFacts: [],
      }),
    ]);
    const service = new TaskStateService(repo, llm, modelRepo);

    const result = await service.reconcile(1, "договоримся что Y = определение-2", "ок");
    expect(result.state.terms.X).toBe("определение-1");
    expect(result.state.terms.Y).toBe("определение-2");
  });

  test("without LLM client reconcile is a no-op", async () => {
    repo.upsert({
      sessionId: 1,
      goal: "цель",
      constraints: [],
      terms: {},
      openQuestions: [],
      resolvedFacts: [],
      updatedAt: "",
    });
    const service = new TaskStateService(repo);

    const result = await service.reconcile(1, "q", "a");
    expect(result.changed).toBe(false);
    expect(result.state.goal).toBe("цель");
    expect(result.inputTokens).toBe(0);
  });
});
