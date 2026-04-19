import { describe, test, expect, beforeEach } from "bun:test";
import { TaskStateService } from "./task-state-service";
import type { TaskStateRepository } from "../ports/task-state-repository";
import { createEmptyTaskState, type TaskState } from "../models/task-state";

class InMemoryTaskStateRepository implements TaskStateRepository {
  private store = new Map<number, TaskState>();

  get(sessionId: number): TaskState {
    return this.store.get(sessionId) ?? createEmptyTaskState(sessionId);
  }

  upsert(state: TaskState): void {
    const withTimestamp = state.updatedAt ? state : { ...state, updatedAt: new Date().toISOString() };
    this.store.set(state.sessionId, withTimestamp);
  }

  clear(sessionId: number): void {
    this.store.delete(sessionId);
  }
}

describe("TaskStateService", () => {
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
    const state: TaskState = {
      sessionId: 1,
      goal: "цель",
      constraints: ["c1"],
      terms: { t: "v" },
      openQuestions: ["q"],
      resolvedFacts: ["f"],
      updatedAt: "",
    };
    service.upsert(state);
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

  test("formatForDisplay returns placeholder for empty state", () => {
    const out = service.formatForDisplay(createEmptyTaskState(1));
    expect(out).toBe("Состояние задачи пустое.");
  });

  test("formatForDisplay renders goal, constraints, terms, questions, facts", () => {
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

  test("formatForPrompt returns null for empty state", () => {
    expect(service.formatForPrompt(createEmptyTaskState(1))).toBeNull();
  });

  test("formatForPrompt renders compact block", () => {
    const state: TaskState = {
      sessionId: 1,
      goal: "выбрать cache",
      constraints: ["read-heavy"],
      terms: { "write-through": "кэш+БД синхронно" },
      openQuestions: [],
      resolvedFacts: [],
      updatedAt: "",
    };
    const out = service.formatForPrompt(state);
    expect(out).toContain("[Состояние задачи]");
    expect(out).toContain("Цель: выбрать cache");
    expect(out).toContain("Ограничения: read-heavy");
    expect(out).toContain("write-through=кэш+БД синхронно");
  });

  test("formatForPrompt skips sections that are empty", () => {
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

  test("formatForRawDisplay returns valid JSON", () => {
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
