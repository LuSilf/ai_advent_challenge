import { describe, test, expect, beforeEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteSessionRepository } from "./session-repository";
import { SqliteMessageRepository } from "./message-repository";
import { initDb } from "../../db";

function freshDb(): string {
  const path = join(tmpdir(), `test-session-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  initDb(path);
  return path;
}

describe("SqliteSessionRepository", () => {
  let repo: SqliteSessionRepository;
  let msgRepo: SqliteMessageRepository;

  beforeEach(() => {
    freshDb();
    repo = new SqliteSessionRepository();
    msgRepo = new SqliteMessageRepository();
  });

  test("create returns incrementing ids", () => {
    const id1 = repo.create();
    const id2 = repo.create();
    expect(id2).toBe(id1 + 1);
  });

  test("create with title", () => {
    const id = repo.create("тест");
    const session = repo.getById(id);
    expect(session).not.toBeNull();
    expect(session!.title).toBe("тест");
  });

  test("create with contextStrategy", () => {
    const id = repo.create("test", "sliding");
    const session = repo.getById(id);
    expect(session!.contextStrategy).toBe("sliding");
  });

  test("create default strategy is full", () => {
    const id = repo.create();
    expect(repo.getStrategy(id)).toBe("full");
  });

  test("getById returns null for missing id", () => {
    expect(repo.getById(999)).toBeNull();
  });

  test("getById returns domain Session (camelCase)", () => {
    const id = repo.create("test", "sliding");
    const session = repo.getById(id)!;
    expect(session.contextStrategy).toBe("sliding");
    expect(session.parentSessionId).toBeNull();
    expect(session.branchPointMessageId).toBeNull();
    expect(session.createdAt).toBeDefined();
    expect(session.updatedAt).toBeDefined();
  });

  test("getLastSession returns most recently updated", () => {
    const id1 = repo.create("первая");
    repo.create("вторая");
    msgRepo.add(id1, "user", "bump");
    const last = repo.getLastSession();
    expect(last).not.toBeNull();
    expect(last!.id).toBe(id1);
  });

  test("getLastSession returns null when no sessions", () => {
    expect(repo.getLastSession()).toBeNull();
  });

  test("getAll returns sessions with message counts (camelCase)", () => {
    const id = repo.create("сессия");
    msgRepo.add(id, "user", "привет");
    msgRepo.add(id, "assistant", "ответ");
    const sessions = repo.getAll();
    expect(sessions.length).toBe(1);
    expect(sessions[0].id).toBe(id);
    expect(sessions[0].messageCount).toBe(2);
  });

  test("delete removes session", () => {
    const id = repo.create();
    msgRepo.add(id, "user", "test");
    expect(repo.delete(id)).toBe(true);
    expect(repo.getById(id)).toBeNull();
  });

  test("delete returns false for missing id", () => {
    expect(repo.delete(999)).toBe(false);
  });

  test("updateTitle updates title", () => {
    const id = repo.create();
    repo.updateTitle(id, "новое имя");
    expect(repo.getById(id)!.title).toBe("новое имя");
  });

  test("updateTitleIfNull only updates if title is null", () => {
    const id = repo.create("имя");
    repo.updateTitleIfNull(id, "другое");
    expect(repo.getById(id)!.title).toBe("имя");

    const id2 = repo.create();
    repo.updateTitleIfNull(id2, "авто");
    expect(repo.getById(id2)!.title).toBe("авто");
  });

  test("getStrategy and setStrategy", () => {
    const id = repo.create();
    expect(repo.getStrategy(id)).toBe("full");
    repo.setStrategy(id, "sliding");
    expect(repo.getStrategy(id)).toBe("sliding");
  });

  test("createBranch copies messages up to checkpoint", () => {
    const id = repo.create("parent");
    msgRepo.add(id, "user", "msg1");
    msgRepo.add(id, "assistant", "msg2");
    msgRepo.add(id, "user", "msg3");

    const msgs = msgRepo.getBySession(id);
    const checkpointMsgId = msgs[1].id;

    const branchId = repo.createBranch(id, checkpointMsgId, "branch1");
    const branchMsgs = msgRepo.getBySession(branchId);
    expect(branchMsgs).toHaveLength(2);
    expect(branchMsgs[0].content).toBe("msg1");
    expect(branchMsgs[1].content).toBe("msg2");

    const branchSession = repo.getById(branchId)!;
    expect(branchSession.parentSessionId).toBe(id);
    expect(branchSession.branchPointMessageId).toBe(checkpointMsgId);
    expect(branchSession.title).toBe("branch1");
  });

  test("createBranch inherits parent strategy", () => {
    const id = repo.create("parent", "sliding");
    msgRepo.add(id, "user", "msg1");
    const msgs = msgRepo.getBySession(id);
    const branchId = repo.createBranch(id, msgs[0].id);
    expect(repo.getStrategy(branchId)).toBe("sliding");
  });

  test("getBranches returns all branches", () => {
    const id = repo.create("parent");
    msgRepo.add(id, "user", "msg1");
    msgRepo.add(id, "assistant", "msg2");
    const msgs = msgRepo.getBySession(id);

    const b1 = repo.createBranch(id, msgs[1].id, "branch1");
    const b2 = repo.createBranch(id, msgs[1].id, "branch2");

    const branches = repo.getBranches(id);
    expect(branches.length).toBeGreaterThanOrEqual(2);
    const branchIds = branches.map((b) => b.id);
    expect(branchIds).toContain(b1);
    expect(branchIds).toContain(b2);
  });
});
