import { describe, test, expect, beforeEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteTaskStateRepository } from "./task-state-repository";
import { SqliteSessionRepository } from "./session-repository";
import { initDb } from "../../db";
import { createEmptyTaskState, type TaskState } from "../../domain/models/task-state";

function freshDb(): void {
  const path = join(tmpdir(), `test-task-state-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  initDb(path);
}

function sampleState(sessionId: number): TaskState {
  return {
    sessionId,
    goal: "горизонтально масштабировать RDBMS",
    constraints: ["только open source", "read-heavy"],
    terms: { "репликация": "master-slave", "шард": "partition by user_id" },
    openQuestions: ["как обрабатывать cross-shard join?"],
    resolvedFacts: ["федерация разделяет данные по доменам"],
    updatedAt: "",
  };
}

describe("SqliteTaskStateRepository", () => {
  let repo: SqliteTaskStateRepository;
  let sessionRepo: SqliteSessionRepository;

  beforeEach(() => {
    freshDb();
    repo = new SqliteTaskStateRepository();
    sessionRepo = new SqliteSessionRepository();
  });

  test("get returns empty state for unknown session", () => {
    const state = repo.get(42);
    expect(state).toEqual(createEmptyTaskState(42));
  });

  test("upsert persists state and get returns it", () => {
    const sessionId = sessionRepo.create(undefined, "full");
    repo.upsert(sampleState(sessionId));
    const loaded = repo.get(sessionId);
    expect(loaded.goal).toBe("горизонтально масштабировать RDBMS");
    expect(loaded.constraints).toEqual(["только open source", "read-heavy"]);
    expect(loaded.terms).toEqual({ "репликация": "master-slave", "шард": "partition by user_id" });
    expect(loaded.openQuestions).toEqual(["как обрабатывать cross-shard join?"]);
    expect(loaded.resolvedFacts).toEqual(["федерация разделяет данные по доменам"]);
    expect(loaded.updatedAt).not.toBe("");
  });

  test("upsert overwrites previous state", () => {
    const sessionId = sessionRepo.create(undefined, "full");
    repo.upsert(sampleState(sessionId));
    const updated: TaskState = {
      ...sampleState(sessionId),
      goal: "выбрать cache",
      constraints: ["write-heavy"],
    };
    repo.upsert(updated);
    const loaded = repo.get(sessionId);
    expect(loaded.goal).toBe("выбрать cache");
    expect(loaded.constraints).toEqual(["write-heavy"]);
  });

  test("clear removes state for session", () => {
    const sessionId = sessionRepo.create(undefined, "full");
    repo.upsert(sampleState(sessionId));
    repo.clear(sessionId);
    const loaded = repo.get(sessionId);
    expect(loaded).toEqual(createEmptyTaskState(sessionId));
  });

  test("states are isolated per session", () => {
    const s1 = sessionRepo.create(undefined, "full");
    const s2 = sessionRepo.create(undefined, "full");
    repo.upsert({ ...sampleState(s1), goal: "goal-1" });
    repo.upsert({ ...sampleState(s2), goal: "goal-2" });
    expect(repo.get(s1).goal).toBe("goal-1");
    expect(repo.get(s2).goal).toBe("goal-2");
  });

  test("deleting a session cascades and removes task state", () => {
    const sessionId = sessionRepo.create(undefined, "full");
    repo.upsert(sampleState(sessionId));
    sessionRepo.delete(sessionId);
    expect(repo.get(sessionId)).toEqual(createEmptyTaskState(sessionId));
  });

  test("empty arrays and objects round-trip correctly", () => {
    const sessionId = sessionRepo.create(undefined, "full");
    const empty: TaskState = {
      sessionId,
      goal: null,
      constraints: [],
      terms: {},
      openQuestions: [],
      resolvedFacts: [],
      updatedAt: "",
    };
    repo.upsert(empty);
    const loaded = repo.get(sessionId);
    expect(loaded.goal).toBeNull();
    expect(loaded.constraints).toEqual([]);
    expect(loaded.terms).toEqual({});
    expect(loaded.openQuestions).toEqual([]);
    expect(loaded.resolvedFacts).toEqual([]);
  });
});
