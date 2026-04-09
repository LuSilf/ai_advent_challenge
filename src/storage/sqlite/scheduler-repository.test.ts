import { describe, test, expect, beforeEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteSchedulerRepository } from "./scheduler-repository";
import { initDb } from "../../db";

function freshDb(): void {
  const path = join(tmpdir(), `test-scheduler-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  initDb(path);
}

describe("SqliteSchedulerRepository", () => {
  let repo: SqliteSchedulerRepository;

  beforeEach(() => {
    freshDb();
    repo = new SqliteSchedulerRepository();
  });

  test("findAllTasks returns empty list initially", () => {
    expect(repo.findAllTasks()).toEqual([]);
  });

  test("createTask and findTaskById", () => {
    // Need a session first
    const { getDb } = require("../../db");
    getDb().run("INSERT INTO sessions (title) VALUES (?)", ["test"]);

    const id = repo.createTask({
      sessionId: 1,
      name: "test task",
      cronExpression: "*/5 * * * *",
      prompt: "tell me a joke",
      enabled: true,
      nextRunAt: "2026-01-01T00:05:00.000Z",
    });

    const task = repo.findTaskById(id);
    expect(task).not.toBeNull();
    expect(task!.name).toBe("test task");
    expect(task!.cronExpression).toBe("*/5 * * * *");
    expect(task!.prompt).toBe("tell me a joke");
    expect(task!.enabled).toBe(true);
    expect(task!.nextRunAt).toBe("2026-01-01T00:05:00.000Z");
    expect(task!.lastRunAt).toBeNull();
  });

  test("findTasksBySessionId filters by session", () => {
    const { getDb } = require("../../db");
    getDb().run("INSERT INTO sessions (title) VALUES (?)", ["s1"]);
    getDb().run("INSERT INTO sessions (title) VALUES (?)", ["s2"]);

    repo.createTask({ sessionId: 1, name: "t1", cronExpression: "* * * * *", prompt: "p1", enabled: true, nextRunAt: null });
    repo.createTask({ sessionId: 2, name: "t2", cronExpression: "* * * * *", prompt: "p2", enabled: true, nextRunAt: null });

    expect(repo.findTasksBySessionId(1)).toHaveLength(1);
    expect(repo.findTasksBySessionId(1)[0].name).toBe("t1");
  });

  test("findDueTasks returns tasks where next_run_at <= now", () => {
    const { getDb } = require("../../db");
    getDb().run("INSERT INTO sessions (title) VALUES (?)", ["s1"]);

    repo.createTask({ sessionId: 1, name: "past", cronExpression: "* * * * *", prompt: "p", enabled: true, nextRunAt: "2020-01-01T00:00:00.000Z" });
    repo.createTask({ sessionId: 1, name: "future", cronExpression: "* * * * *", prompt: "p", enabled: true, nextRunAt: "2099-01-01T00:00:00.000Z" });
    repo.createTask({ sessionId: 1, name: "disabled", cronExpression: "* * * * *", prompt: "p", enabled: false, nextRunAt: "2020-01-01T00:00:00.000Z" });

    const due = repo.findDueTasks("2026-01-01T00:00:00.000Z");
    expect(due).toHaveLength(1);
    expect(due[0].name).toBe("past");
  });

  test("updateTask changes fields", () => {
    const { getDb } = require("../../db");
    getDb().run("INSERT INTO sessions (title) VALUES (?)", ["s1"]);

    const id = repo.createTask({ sessionId: 1, name: "t", cronExpression: "* * * * *", prompt: "p", enabled: true, nextRunAt: null });

    repo.updateTask(id, { enabled: false });
    expect(repo.findTaskById(id)!.enabled).toBe(false);

    repo.updateTask(id, { lastRunAt: "2026-01-01T00:00:00.000Z", nextRunAt: "2026-01-01T01:00:00.000Z" });
    const updated = repo.findTaskById(id)!;
    expect(updated.lastRunAt).toBe("2026-01-01T00:00:00.000Z");
    expect(updated.nextRunAt).toBe("2026-01-01T01:00:00.000Z");
  });

  test("deleteTask removes task", () => {
    const { getDb } = require("../../db");
    getDb().run("INSERT INTO sessions (title) VALUES (?)", ["s1"]);

    const id = repo.createTask({ sessionId: 1, name: "t", cronExpression: "* * * * *", prompt: "p", enabled: true, nextRunAt: null });
    expect(repo.deleteTask(id)).toBe(true);
    expect(repo.findTaskById(id)).toBeNull();
  });

  test("deleteTask returns false for nonexistent", () => {
    expect(repo.deleteTask(999)).toBe(false);
  });

  test("addExecution and findExecutionsByTaskId", () => {
    const { getDb } = require("../../db");
    getDb().run("INSERT INTO sessions (title) VALUES (?)", ["s1"]);
    const taskId = repo.createTask({ sessionId: 1, name: "t", cronExpression: "* * * * *", prompt: "p", enabled: true, nextRunAt: null });

    repo.addExecution({
      taskId,
      status: "success",
      result: "hello world",
      error: null,
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:00:01.000Z",
      tokensUsed: 100,
    });

    const execs = repo.findExecutionsByTaskId(taskId);
    expect(execs).toHaveLength(1);
    expect(execs[0].status).toBe("success");
    expect(execs[0].result).toBe("hello world");
    expect(execs[0].tokensUsed).toBe(100);
  });

  test("findRecentExecutions returns latest across all tasks", () => {
    const { getDb } = require("../../db");
    getDb().run("INSERT INTO sessions (title) VALUES (?)", ["s1"]);
    const t1 = repo.createTask({ sessionId: 1, name: "t1", cronExpression: "* * * * *", prompt: "p1", enabled: true, nextRunAt: null });
    const t2 = repo.createTask({ sessionId: 1, name: "t2", cronExpression: "* * * * *", prompt: "p2", enabled: true, nextRunAt: null });

    repo.addExecution({ taskId: t1, status: "success", result: "r1", error: null, startedAt: "2026-01-01T00:00:00Z", finishedAt: "2026-01-01T00:00:01Z", tokensUsed: 10 });
    repo.addExecution({ taskId: t2, status: "error", result: null, error: "fail", startedAt: "2026-01-01T00:01:00Z", finishedAt: "2026-01-01T00:01:01Z", tokensUsed: 0 });

    const recent = repo.findRecentExecutions();
    expect(recent).toHaveLength(2);
    expect(recent[0].taskId).toBe(t2); // most recent first (DESC)
  });
});
