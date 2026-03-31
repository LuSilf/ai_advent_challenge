import { describe, test, expect, beforeEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteMessageRepository } from "./message-repository";
import { SqliteSessionRepository } from "./session-repository";
import { initDb } from "../../db";

function freshDb(): string {
  const path = join(tmpdir(), `test-msg-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  initDb(path);
  return path;
}

describe("SqliteMessageRepository", () => {
  let repo: SqliteMessageRepository;
  let sessionRepo: SqliteSessionRepository;
  let sessionId: number;

  beforeEach(() => {
    freshDb();
    repo = new SqliteMessageRepository();
    sessionRepo = new SqliteSessionRepository();
    sessionId = sessionRepo.create();
  });

  test("add and getBySession", () => {
    repo.add(sessionId, "user", "вопрос");
    repo.add(sessionId, "assistant", "ответ");
    repo.add(sessionId, "user", "ещё вопрос");

    const msgs = repo.getBySession(sessionId);
    expect(msgs).toHaveLength(3);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toBe("вопрос");
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[2].role).toBe("user");
  });

  test("getBySession returns domain Message (camelCase)", () => {
    repo.add(sessionId, "user", "test");
    const msgs = repo.getBySession(sessionId);
    expect(msgs[0].sessionId).toBe(sessionId);
    expect(msgs[0].createdAt).toBeDefined();
    expect(msgs[0].id).toBeDefined();
  });

  test("getBySession with limit returns last N in order", () => {
    repo.add(sessionId, "user", "1");
    repo.add(sessionId, "assistant", "2");
    repo.add(sessionId, "user", "3");
    repo.add(sessionId, "assistant", "4");

    const msgs = repo.getBySession(sessionId, 2);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].content).toBe("3");
    expect(msgs[1].content).toBe("4");
  });

  test("getCount", () => {
    expect(repo.getCount(sessionId)).toBe(0);
    repo.add(sessionId, "user", "a");
    repo.add(sessionId, "assistant", "b");
    expect(repo.getCount(sessionId)).toBe(2);
  });

  test("deleteBySession removes messages but keeps session", () => {
    repo.add(sessionId, "user", "a");
    repo.add(sessionId, "assistant", "b");
    repo.deleteBySession(sessionId);
    expect(repo.getBySession(sessionId)).toEqual([]);
    expect(sessionRepo.getById(sessionId)).not.toBeNull();
  });
});
