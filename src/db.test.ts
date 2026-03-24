import { describe, test, expect, beforeEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlinkSync } from "node:fs";

import {
  initDb,
  createSession,
  getLastSession,
  getSession,
  listSessions,
  deleteSession,
  renameSession,
  updateSessionTitle,
  addMessage,
  getMessages,
  getMessageCount,
  clearMessages
} from "./db";

function freshDb(): string {
  const path = join(tmpdir(), `test-history-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  initDb(path);
  return path;
}

describe("db", () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = freshDb();
  });

  test("createSession returns incrementing ids", () => {
    const id1 = createSession();
    const id2 = createSession();
    expect(id2).toBe(id1 + 1);
  });

  test("createSession with title", () => {
    const id = createSession("тест");
    const session = getSession(id);
    expect(session).not.toBeNull();
    expect(session!.title).toBe("тест");
  });

  test("getSession returns null for missing id", () => {
    expect(getSession(999)).toBeNull();
  });

  test("getLastSession returns most recently updated", () => {
    const id1 = createSession("первая");
    const id2 = createSession("вторая");
    // addMessage updates updated_at, making id1 the most recent
    addMessage(id1, "user", "bump");
    const last = getLastSession();
    expect(last).not.toBeNull();
    expect(last!.id).toBe(id1);
  });

  test("getLastSession returns null when no sessions", () => {
    expect(getLastSession()).toBeNull();
  });

  test("listSessions returns sessions with message counts", () => {
    const id = createSession("сессия");
    addMessage(id, "user", "привет");
    addMessage(id, "assistant", "ответ");

    const sessions = listSessions();
    expect(sessions.length).toBe(1);
    expect(sessions[0].id).toBe(id);
    expect(sessions[0].message_count).toBe(2);
  });

  test("deleteSession removes session and its messages", () => {
    const id = createSession();
    addMessage(id, "user", "test");
    expect(deleteSession(id)).toBe(true);
    expect(getSession(id)).toBeNull();
    expect(getMessages(id)).toEqual([]);
  });

  test("deleteSession returns false for missing id", () => {
    expect(deleteSession(999)).toBe(false);
  });

  test("renameSession updates title", () => {
    const id = createSession();
    renameSession(id, "новое имя");
    expect(getSession(id)!.title).toBe("новое имя");
  });

  test("updateSessionTitle only updates if title is null", () => {
    const id = createSession("имя");
    updateSessionTitle(id, "другое");
    expect(getSession(id)!.title).toBe("имя");

    const id2 = createSession();
    expect(getSession(id2)!.title).toBeNull();
    updateSessionTitle(id2, "авто");
    expect(getSession(id2)!.title).toBe("авто");
  });

  test("addMessage and getMessages", () => {
    const id = createSession();
    addMessage(id, "user", "вопрос");
    addMessage(id, "assistant", "ответ");
    addMessage(id, "user", "ещё вопрос");

    const msgs = getMessages(id);
    expect(msgs).toHaveLength(3);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toBe("вопрос");
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[2].role).toBe("user");
  });

  test("getMessages with limit returns last N in order", () => {
    const id = createSession();
    addMessage(id, "user", "1");
    addMessage(id, "assistant", "2");
    addMessage(id, "user", "3");
    addMessage(id, "assistant", "4");

    const msgs = getMessages(id, 2);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].content).toBe("3");
    expect(msgs[1].content).toBe("4");
  });

  test("getMessageCount", () => {
    const id = createSession();
    expect(getMessageCount(id)).toBe(0);
    addMessage(id, "user", "a");
    addMessage(id, "assistant", "b");
    expect(getMessageCount(id)).toBe(2);
  });

  test("clearMessages removes messages but keeps session", () => {
    const id = createSession();
    addMessage(id, "user", "a");
    addMessage(id, "assistant", "b");
    clearMessages(id);
    expect(getMessages(id)).toEqual([]);
    expect(getSession(id)).not.toBeNull();
  });
});
