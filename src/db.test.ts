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
  getSessionStrategy,
  setSessionStrategy,
  getFacts,
  upsertFacts,
  clearFacts,
  createCheckpoint,
  getLastCheckpoint,
  createBranch,
  listBranches,
  getModel,
  listModels,
  getModelForRole,
  listModelRoles,
  setModelForRole,
  calculateCost,
  formatCost,
  getOption,
  setOption,
  listOptions
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

  test("createSession with contextStrategy", () => {
    const id = createSession("test", "sliding");
    const session = getSession(id);
    expect(session!.context_strategy).toBe("sliding");
  });

  test("createSession default strategy is full", () => {
    const id = createSession();
    expect(getSessionStrategy(id)).toBe("full");
  });

  test("getSessionStrategy and setSessionStrategy", () => {
    const id = createSession();
    expect(getSessionStrategy(id)).toBe("full");
    setSessionStrategy(id, "sliding");
    expect(getSessionStrategy(id)).toBe("sliding");
    setSessionStrategy(id, "facts");
    expect(getSessionStrategy(id)).toBe("facts");
  });

  // --- Facts ---

  test("getFacts returns empty for new session", () => {
    const id = createSession();
    expect(getFacts(id)).toEqual([]);
  });

  test("upsertFacts inserts and updates facts", () => {
    const id = createSession();
    upsertFacts(id, [
      { key: "цель", value: "тестирование" },
      { key: "язык", value: "TypeScript" }
    ]);
    const facts = getFacts(id);
    expect(facts).toHaveLength(2);
    expect(facts[0]).toEqual({ key: "цель", value: "тестирование" });
    expect(facts[1]).toEqual({ key: "язык", value: "TypeScript" });

    // upsert обновляет
    upsertFacts(id, [{ key: "язык", value: "Python" }]);
    const updated = getFacts(id);
    expect(updated.find((f) => f.key === "язык")!.value).toBe("Python");
  });

  test("clearFacts removes all facts", () => {
    const id = createSession();
    upsertFacts(id, [{ key: "a", value: "b" }]);
    clearFacts(id);
    expect(getFacts(id)).toEqual([]);
  });

  test("facts cascade deleted with session", () => {
    const id = createSession();
    upsertFacts(id, [{ key: "a", value: "b" }]);
    deleteSession(id);
    expect(getFacts(id)).toEqual([]);
  });

  // --- Checkpoints & Branching ---

  test("createCheckpoint saves last message id", () => {
    const id = createSession();
    addMessage(id, "user", "msg1");
    addMessage(id, "assistant", "msg2");
    const msgId = createCheckpoint(id);
    const msgs = getMessages(id);
    expect(msgId).toBe(msgs[msgs.length - 1].id);
  });

  test("createCheckpoint throws on empty session", () => {
    const id = createSession();
    expect(() => createCheckpoint(id)).toThrow("Нет сообщений");
  });

  test("getLastCheckpoint returns latest", () => {
    const id = createSession();
    addMessage(id, "user", "msg1");
    createCheckpoint(id);
    addMessage(id, "assistant", "msg2");
    const cp2 = createCheckpoint(id);
    const last = getLastCheckpoint(id);
    expect(last).not.toBeNull();
    expect(last!.message_id).toBe(cp2);
  });

  test("getLastCheckpoint returns null if none", () => {
    const id = createSession();
    expect(getLastCheckpoint(id)).toBeNull();
  });

  test("createBranch copies messages up to checkpoint", () => {
    const id = createSession("parent");
    addMessage(id, "user", "msg1");
    addMessage(id, "assistant", "msg2");
    addMessage(id, "user", "msg3");

    const msgs = getMessages(id);
    const checkpointMsgId = msgs[1].id; // after msg2

    const branchId = createBranch(id, checkpointMsgId, "branch1");
    const branchMsgs = getMessages(branchId);
    expect(branchMsgs).toHaveLength(2);
    expect(branchMsgs[0].content).toBe("msg1");
    expect(branchMsgs[1].content).toBe("msg2");

    const branchSession = getSession(branchId);
    expect(branchSession!.parent_session_id).toBe(id);
    expect(branchSession!.branch_point_message_id).toBe(checkpointMsgId);
    expect(branchSession!.title).toBe("branch1");
  });

  test("createBranch inherits parent strategy", () => {
    const id = createSession("parent", "sliding");
    addMessage(id, "user", "msg1");
    const msgs = getMessages(id);
    const branchId = createBranch(id, msgs[0].id);
    expect(getSessionStrategy(branchId)).toBe("sliding");
  });

  // --- Models ---

  test("listModels returns seeded models", () => {
    const models = listModels();
    expect(models.length).toBe(7);
    const ids = models.map((m) => m.id);
    expect(ids).toContain("openai/gpt-5-nano");
    expect(ids).toContain("deepseek/deepseek-v3.2");
  });

  test("getModel returns model by id", () => {
    const model = getModel("openai/gpt-5-nano");
    expect(model).not.toBeNull();
    expect(model!.name).toBe("GPT-5 Nano");
    expect(model!.input_price).toBe(0.05);
    expect(model!.output_price).toBe(0.40);
    expect(model!.context_size).toBe(400_000);
  });

  test("getModel returns null for unknown id", () => {
    expect(getModel("nonexistent/model")).toBeNull();
  });

  // --- Model Roles ---

  test("getModelForRole returns default model for chat", () => {
    const model = getModelForRole("chat");
    expect(model).not.toBeNull();
    expect(model!.id).toBe("openai/gpt-5-nano");
  });

  test("getModelForRole returns null for unknown role", () => {
    expect(getModelForRole("nonexistent")).toBeNull();
  });

  test("listModelRoles returns all default roles", () => {
    const roles = listModelRoles();
    expect(roles.length).toBe(3);
    const roleNames = roles.map((r) => r.role);
    expect(roleNames).toContain("chat");
    expect(roleNames).toContain("title");
    expect(roleNames).toContain("facts");
  });

  test("setModelForRole changes model for role", () => {
    setModelForRole("chat", "deepseek/deepseek-v3.2");
    const model = getModelForRole("chat");
    expect(model).not.toBeNull();
    expect(model!.id).toBe("deepseek/deepseek-v3.2");
  });

  test("setModelForRole throws for nonexistent model", () => {
    expect(() => setModelForRole("chat", "nonexistent/model")).toThrow("не найдена");
  });

  // --- Cost calculation ---

  test("calculateCost computes correctly", () => {
    const model = getModel("openai/gpt-5-nano")!;
    // input: 0.05 $/1M, output: 0.40 $/1M
    // 1000 in tokens = 0.05 * 1000 / 1_000_000 = 0.00005
    // 500 out tokens = 0.40 * 500 / 1_000_000 = 0.0002
    const info = calculateCost(model, 1000, 500);
    expect(info.inputTokens).toBe(1000);
    expect(info.outputTokens).toBe(500);
    expect(info.cost).toBeCloseTo(0.00025, 8);
  });

  test("calculateCost with zero tokens", () => {
    const model = getModel("openai/gpt-5-nano")!;
    const info = calculateCost(model, 0, 0);
    expect(info.cost).toBe(0);
  });

  test("formatCost formats small cost", () => {
    const result = formatCost({ cost: 0.000250, inputTokens: 1000, outputTokens: 500 });
    expect(result).toContain("$0.000250");
    expect(result).toContain("1000 in");
    expect(result).toContain("500 out");
  });

  test("formatCost formats larger cost", () => {
    const result = formatCost({ cost: 0.1234, inputTokens: 50000, outputTokens: 30000 });
    expect(result).toContain("$0.1234");
  });

  test("listBranches returns all branches of a session", () => {
    const id = createSession("parent");
    addMessage(id, "user", "msg1");
    addMessage(id, "assistant", "msg2");
    const msgs = getMessages(id);

    const b1 = createBranch(id, msgs[1].id, "branch1");
    const b2 = createBranch(id, msgs[1].id, "branch2");

    const branches = listBranches(id);
    expect(branches.length).toBeGreaterThanOrEqual(2);
    const branchIds = branches.map((b) => b.id);
    expect(branchIds).toContain(b1);
    expect(branchIds).toContain(b2);
  });
});

describe("options", () => {
  beforeEach(() => { freshDb(); });

  test("default memory_interval is 5", () => {
    expect(getOption("memory_interval")).toBe("5");
  });

  test("getOption returns null for unknown key", () => {
    expect(getOption("unknown_key")).toBeNull();
  });

  test("setOption creates new option", () => {
    setOption("new_key", "new_value");
    expect(getOption("new_key")).toBe("new_value");
  });

  test("setOption updates existing option", () => {
    setOption("memory_interval", "10");
    expect(getOption("memory_interval")).toBe("10");
  });

  test("listOptions returns all options", () => {
    const opts = listOptions();
    expect(opts.length).toBeGreaterThanOrEqual(1);
    const keys = opts.map((o) => o.key);
    expect(keys).toContain("memory_interval");
  });
});
