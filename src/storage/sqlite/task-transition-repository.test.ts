import { describe, test, expect, beforeEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteTaskTransitionRepository } from "./task-transition-repository";
import { SqliteTaskRepository } from "./task-repository";
import { SqliteSessionRepository } from "./session-repository";
import { initDb } from "../../db";

function freshDb(): void {
  const path = join(tmpdir(), `test-transition-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  initDb(path);
}

describe("SqliteTaskTransitionRepository", () => {
  let repo: SqliteTaskTransitionRepository;
  let taskRepo: SqliteTaskRepository;
  let sessionId: number;
  let taskId: number;

  beforeEach(() => {
    freshDb();
    repo = new SqliteTaskTransitionRepository();
    taskRepo = new SqliteTaskRepository();
    const sessionRepo = new SqliteSessionRepository();
    sessionId = sessionRepo.create("test session");
    taskId = taskRepo.create(sessionId, "Тестовая задача");
  });

  test("log создаёт запись перехода", () => {
    repo.log(taskId, null, "planning", "user");
    const transitions = repo.findByTaskId(taskId);
    expect(transitions).toHaveLength(1);
    expect(transitions[0].taskId).toBe(taskId);
    expect(transitions[0].fromPhase).toBeNull();
    expect(transitions[0].toPhase).toBe("planning");
    expect(transitions[0].triggeredBy).toBe("user");
    expect(transitions[0].createdAt).toBeDefined();
  });

  test("log создаёт несколько записей в порядке", () => {
    repo.log(taskId, null, "planning", "user");
    repo.log(taskId, "planning", "execution", "llm");
    repo.log(taskId, "execution", "validation", "llm");

    const transitions = repo.findByTaskId(taskId);
    expect(transitions).toHaveLength(3);
    expect(transitions[0].toPhase).toBe("planning");
    expect(transitions[1].toPhase).toBe("execution");
    expect(transitions[2].toPhase).toBe("validation");
  });

  test("findByTaskId возвращает пустой массив если нет переходов", () => {
    expect(repo.findByTaskId(taskId)).toHaveLength(0);
  });

  test("findByTaskId не возвращает переходы других задач", () => {
    const otherTaskId = taskRepo.create(sessionId, "Другая задача");
    repo.log(taskId, null, "planning", "user");
    repo.log(otherTaskId, null, "planning", "user");

    const transitions = repo.findByTaskId(taskId);
    expect(transitions).toHaveLength(1);
    expect(transitions[0].taskId).toBe(taskId);
  });

  test("triggered_by сохраняется корректно для всех типов", () => {
    repo.log(taskId, null, "planning", "user");
    repo.log(taskId, "planning", "paused", "system");
    repo.log(taskId, "paused", "planning", "system");
    repo.log(taskId, "planning", "execution", "llm");

    const transitions = repo.findByTaskId(taskId);
    expect(transitions[0].triggeredBy).toBe("user");
    expect(transitions[1].triggeredBy).toBe("system");
    expect(transitions[2].triggeredBy).toBe("system");
    expect(transitions[3].triggeredBy).toBe("llm");
  });
});
