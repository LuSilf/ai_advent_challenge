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
  clearMessages,
  saveTokenUsage,
  getSessionTokenUsage,
  getSessionTokenTotals,
  getExchangeCount,
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

  // --- Token usage ---

  test("saveTokenUsage and getSessionTokenUsage", () => {
    const id = createSession();
    saveTokenUsage(id, {
      exchangeNum: 1,
      inputTokens: 100,
      outputTokens: 50,
      cachedTokens: 20,
      reasoningTokens: 0,
      totalTokens: 150,
      inputCost: 0.001,
      outputCost: 0.002,
      totalCost: 0.003,
    });
    saveTokenUsage(id, {
      exchangeNum: 2,
      inputTokens: 200,
      outputTokens: 80,
      cachedTokens: 50,
      reasoningTokens: 10,
      totalTokens: 280,
      inputCost: 0.002,
      outputCost: 0.003,
      totalCost: 0.005,
    });

    const rows = getSessionTokenUsage(id);
    expect(rows).toHaveLength(2);
    expect(rows[0].exchangeNum).toBe(1);
    expect(rows[0].inputTokens).toBe(100);
    expect(rows[0].cachedTokens).toBe(20);
    expect(rows[1].exchangeNum).toBe(2);
    expect(rows[1].reasoningTokens).toBe(10);
    expect(rows[1].totalCost).toBeCloseTo(0.005);
  });

  test("getSessionTokenTotals sums correctly", () => {
    const id = createSession();
    saveTokenUsage(id, {
      exchangeNum: 1,
      inputTokens: 100,
      outputTokens: 50,
      cachedTokens: 0,
      reasoningTokens: 0,
      totalTokens: 150,
      inputCost: 0.001,
      outputCost: 0.002,
      totalCost: 0.003,
    });
    saveTokenUsage(id, {
      exchangeNum: 2,
      inputTokens: 200,
      outputTokens: 80,
      cachedTokens: 0,
      reasoningTokens: 0,
      totalTokens: 280,
      inputCost: 0.002,
      outputCost: 0.003,
      totalCost: 0.005,
    });

    const totals = getSessionTokenTotals(id);
    expect(totals.totalTokens).toBe(430);
    expect(totals.totalCost).toBeCloseTo(0.008);
  });

  test("getSessionTokenTotals returns zeros for empty session", () => {
    const id = createSession();
    const totals = getSessionTokenTotals(id);
    expect(totals.totalTokens).toBe(0);
    expect(totals.totalCost).toBe(0);
  });

  test("getExchangeCount returns max exchange_num", () => {
    const id = createSession();
    expect(getExchangeCount(id)).toBe(0);

    saveTokenUsage(id, {
      exchangeNum: 1,
      inputTokens: 10,
      outputTokens: 5,
      cachedTokens: 0,
      reasoningTokens: 0,
      totalTokens: 15,
      inputCost: 0,
      outputCost: 0,
      totalCost: 0,
    });
    expect(getExchangeCount(id)).toBe(1);

    saveTokenUsage(id, {
      exchangeNum: 2,
      inputTokens: 20,
      outputTokens: 10,
      cachedTokens: 0,
      reasoningTokens: 0,
      totalTokens: 30,
      inputCost: 0,
      outputCost: 0,
      totalCost: 0,
    });
    expect(getExchangeCount(id)).toBe(2);
  });

  test("token_usage cascade deletes with session", () => {
    const id = createSession();
    saveTokenUsage(id, {
      exchangeNum: 1,
      inputTokens: 10,
      outputTokens: 5,
      cachedTokens: 0,
      reasoningTokens: 0,
      totalTokens: 15,
      inputCost: 0,
      outputCost: 0,
      totalCost: 0,
    });
    deleteSession(id);
    expect(getSessionTokenUsage(id)).toEqual([]);
  });
});
