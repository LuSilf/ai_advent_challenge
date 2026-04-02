import { describe, test, expect, beforeEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteTaskRepository } from "./task-repository";
import { SqliteSessionRepository } from "./session-repository";
import { initDb } from "../../db";

function freshDb(): void {
  const path = join(tmpdir(), `test-task-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  initDb(path);
}

describe("SqliteTaskRepository", () => {
  let repo: SqliteTaskRepository;
  let sessionRepo: SqliteSessionRepository;
  let sessionId: number;

  beforeEach(() => {
    freshDb();
    repo = new SqliteTaskRepository();
    sessionRepo = new SqliteSessionRepository();
    sessionId = sessionRepo.create("test session");
  });

  test("create возвращает id и задача в фазе planning", () => {
    const id = repo.create(sessionId, "Реализовать фичу");
    expect(id).toBeGreaterThan(0);

    const task = repo.findById(id);
    expect(task).not.toBeNull();
    expect(task!.title).toBe("Реализовать фичу");
    expect(task!.phase).toBe("planning");
    expect(task!.previousPhase).toBeNull();
    expect(task!.sessionId).toBe(sessionId);
    expect(task!.summary).toBeNull();
  });

  test("create возвращает инкрементные id", () => {
    const id1 = repo.create(sessionId, "Задача 1");
    const id2 = repo.create(sessionId, "Задача 2");
    expect(id2).toBe(id1 + 1);
  });

  test("findById возвращает null для несуществующего id", () => {
    expect(repo.findById(999)).toBeNull();
  });

  test("findBySessionId возвращает все задачи сессии", () => {
    repo.create(sessionId, "Задача 1");
    repo.create(sessionId, "Задача 2");

    const otherSession = sessionRepo.create("other");
    repo.create(otherSession, "Чужая задача");

    const tasks = repo.findBySessionId(sessionId);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].title).toBe("Задача 1");
    expect(tasks[1].title).toBe("Задача 2");
  });

  test("findBySessionId возвращает пустой массив если задач нет", () => {
    expect(repo.findBySessionId(sessionId)).toHaveLength(0);
  });

  test("findActive возвращает задачу не в paused/done/cancelled", () => {
    const id = repo.create(sessionId, "Активная задача");
    const active = repo.findActive(sessionId);
    expect(active).not.toBeNull();
    expect(active!.id).toBe(id);
  });

  test("findActive возвращает null если все задачи paused", () => {
    const id = repo.create(sessionId, "Задача");
    repo.update(id, { phase: "paused", previousPhase: "planning" });
    expect(repo.findActive(sessionId)).toBeNull();
  });

  test("findActive возвращает null если все задачи done", () => {
    const id = repo.create(sessionId, "Задача");
    repo.update(id, { phase: "done" });
    expect(repo.findActive(sessionId)).toBeNull();
  });

  test("findActive возвращает null если нет задач", () => {
    expect(repo.findActive(sessionId)).toBeNull();
  });

  test("update обновляет phase", () => {
    const id = repo.create(sessionId, "Задача");
    repo.update(id, { phase: "execution" });
    expect(repo.findById(id)!.phase).toBe("execution");
  });

  test("update обновляет previousPhase", () => {
    const id = repo.create(sessionId, "Задача");
    repo.update(id, { phase: "paused", previousPhase: "planning" });
    const task = repo.findById(id)!;
    expect(task.phase).toBe("paused");
    expect(task.previousPhase).toBe("planning");
  });

  test("update обновляет summary", () => {
    const id = repo.create(sessionId, "Задача");
    repo.update(id, { summary: "Планируем фичу X" });
    expect(repo.findById(id)!.summary).toBe("Планируем фичу X");
  });

  test("update обновляет updatedAt", () => {
    const id = repo.create(sessionId, "Задача");
    const before = repo.findById(id)!.updatedAt;
    repo.update(id, { summary: "changed" });
    const after = repo.findById(id)!.updatedAt;
    expect(after).toBeDefined();
  });

  test("задачи удаляются при удалении сессии (CASCADE)", () => {
    const id = repo.create(sessionId, "Задача");
    sessionRepo.delete(sessionId);
    expect(repo.findById(id)).toBeNull();
  });
});
