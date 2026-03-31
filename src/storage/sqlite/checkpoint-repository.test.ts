import { describe, test, expect, beforeEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteCheckpointRepository } from "./checkpoint-repository";
import { SqliteSessionRepository } from "./session-repository";
import { SqliteMessageRepository } from "./message-repository";
import { initDb } from "../../db";

function freshDb(): string {
  const path = join(tmpdir(), `test-cp-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  initDb(path);
  return path;
}

describe("SqliteCheckpointRepository", () => {
  let repo: SqliteCheckpointRepository;
  let sessionRepo: SqliteSessionRepository;
  let msgRepo: SqliteMessageRepository;
  let sessionId: number;

  beforeEach(() => {
    freshDb();
    repo = new SqliteCheckpointRepository();
    sessionRepo = new SqliteSessionRepository();
    msgRepo = new SqliteMessageRepository();
    sessionId = sessionRepo.create();
  });

  test("create saves last message id", () => {
    msgRepo.add(sessionId, "user", "msg1");
    msgRepo.add(sessionId, "assistant", "msg2");
    const msgId = repo.create(sessionId);
    const msgs = msgRepo.getBySession(sessionId);
    expect(msgId).toBe(msgs[msgs.length - 1].id);
  });

  test("create throws on empty session", () => {
    expect(() => repo.create(sessionId)).toThrow("Нет сообщений");
  });

  test("getLastBySession returns latest checkpoint", () => {
    msgRepo.add(sessionId, "user", "msg1");
    repo.create(sessionId);
    msgRepo.add(sessionId, "assistant", "msg2");
    const cp2 = repo.create(sessionId);
    const last = repo.getLastBySession(sessionId);
    expect(last).not.toBeNull();
    expect(last!.messageId).toBe(cp2);
  });

  test("getLastBySession returns null if none", () => {
    expect(repo.getLastBySession(sessionId)).toBeNull();
  });
});
