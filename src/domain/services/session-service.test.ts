import { describe, test, expect, beforeEach } from "bun:test";
import { SessionService } from "./session-service";
import type { SessionRepository } from "../ports/session-repository";
import type { MessageRepository } from "../ports/message-repository";
import type { Session, SessionWithCount, Message } from "../models";

function createMockSessionRepo(): SessionRepository & { sessions: Map<number, Session>; nextId: number } {
  let nextId = 1;
  const sessions = new Map<number, Session>();

  return {
    sessions,
    get nextId() { return nextId; },
    create(title?, contextStrategy?) {
      const id = nextId++;
      const now = new Date().toISOString();
      sessions.set(id, {
        id,
        title: title ?? null,
        contextStrategy: contextStrategy ?? "full",
        parentSessionId: null,
        branchPointMessageId: null,
        createdAt: now,
        updatedAt: now,
      });
      return id;
    },
    getById: (id) => sessions.get(id) ?? null,
    getAll: () => [...sessions.values()].map((s) => ({ ...s, messageCount: 0 })),
    update(id, fields) {
      const s = sessions.get(id);
      if (s) {
        if (fields.title !== undefined) s.title = fields.title;
        if (fields.contextStrategy !== undefined) s.contextStrategy = fields.contextStrategy;
      }
    },
    delete(id) {
      return sessions.delete(id);
    },
    getLastSession: () => {
      const all = [...sessions.values()];
      return all.length > 0 ? all[all.length - 1] : null;
    },
    getStrategy: (id) => sessions.get(id)?.contextStrategy ?? "full",
    setStrategy(id, strategy) {
      const s = sessions.get(id);
      if (s) s.contextStrategy = strategy;
    },
    updateTitle(id, title) {
      const s = sessions.get(id);
      if (s) s.title = title;
    },
    updateTitleIfNull(id, title) {
      const s = sessions.get(id);
      if (s && s.title === null) s.title = title;
    },
    createBranch: () => nextId++,
    getBranches: () => [],
  };
}

function createMockMessageRepo(): MessageRepository & { messages: Message[] } {
  const messages: Message[] = [];
  let nextId = 1;

  return {
    messages,
    add(sessionId, role, content) {
      messages.push({
        id: nextId++,
        sessionId,
        role,
        content,
        createdAt: new Date().toISOString(),
      });
    },
    getBySession(sessionId, limit?) {
      const filtered = messages.filter((m) => m.sessionId === sessionId);
      if (limit) return filtered.slice(-limit);
      return filtered;
    },
    getCount(sessionId) {
      return messages.filter((m) => m.sessionId === sessionId).length;
    },
    deleteBySession(sessionId) {
      const toRemove = messages.filter((m) => m.sessionId === sessionId);
      for (const m of toRemove) {
        const idx = messages.indexOf(m);
        if (idx >= 0) messages.splice(idx, 1);
      }
    },
  };
}

describe("SessionService", () => {
  let service: SessionService;
  let sessionRepo: ReturnType<typeof createMockSessionRepo>;
  let msgRepo: ReturnType<typeof createMockMessageRepo>;

  beforeEach(() => {
    sessionRepo = createMockSessionRepo();
    msgRepo = createMockMessageRepo();
    service = new SessionService(sessionRepo, msgRepo);
  });

  test("createSession creates and returns id", () => {
    const id = service.createSession();
    expect(id).toBe(1);
    expect(sessionRepo.getById(id)).not.toBeNull();
  });

  test("createSession with title and strategy", () => {
    const id = service.createSession("тест", "sliding");
    const session = sessionRepo.getById(id)!;
    expect(session.title).toBe("тест");
    expect(session.contextStrategy).toBe("sliding");
  });

  test("getSession returns session", () => {
    const id = service.createSession("test");
    const session = service.getSession(id);
    expect(session).not.toBeNull();
    expect(session!.title).toBe("test");
  });

  test("getSession returns null for missing", () => {
    expect(service.getSession(999)).toBeNull();
  });

  test("listSessions returns all sessions", () => {
    service.createSession("a");
    service.createSession("b");
    expect(service.listSessions()).toHaveLength(2);
  });

  test("deleteSession removes session", () => {
    const id = service.createSession();
    expect(service.deleteSession(id)).toBe(true);
    expect(service.getSession(id)).toBeNull();
  });

  test("renameSession updates title", () => {
    const id = service.createSession();
    service.renameSession(id, "новое");
    expect(service.getSession(id)!.title).toBe("новое");
  });

  test("getHistory returns messages for session", () => {
    const id = service.createSession();
    msgRepo.add(id, "user", "hello");
    msgRepo.add(id, "assistant", "hi");
    const history = service.getHistory(id);
    expect(history).toHaveLength(2);
  });

  test("getHistory with limit", () => {
    const id = service.createSession();
    msgRepo.add(id, "user", "1");
    msgRepo.add(id, "assistant", "2");
    msgRepo.add(id, "user", "3");
    const history = service.getHistory(id, 2);
    expect(history).toHaveLength(2);
    expect(history[0].content).toBe("2");
  });

  test("addMessage adds to session", () => {
    const id = service.createSession();
    service.addMessage(id, "user", "test");
    expect(msgRepo.getCount(id)).toBe(1);
  });

  test("clearMessages clears session messages", () => {
    const id = service.createSession();
    service.addMessage(id, "user", "test");
    service.clearMessages(id);
    expect(service.getHistory(id)).toHaveLength(0);
  });

  test("getMessageCount returns count", () => {
    const id = service.createSession();
    expect(service.getMessageCount(id)).toBe(0);
    service.addMessage(id, "user", "a");
    expect(service.getMessageCount(id)).toBe(1);
  });

  test("getLastSession returns last session", () => {
    service.createSession("first");
    service.createSession("second");
    const last = service.getLastSession();
    expect(last).not.toBeNull();
  });

  test("getStrategy and setStrategy", () => {
    const id = service.createSession();
    expect(service.getStrategy(id)).toBe("full");
    service.setStrategy(id, "sliding");
    expect(service.getStrategy(id)).toBe("sliding");
  });

  test("autoTitle only sets when title is null", () => {
    const id = service.createSession("existing");
    service.autoTitle(id, "new");
    expect(service.getSession(id)!.title).toBe("existing");

    const id2 = service.createSession();
    service.autoTitle(id2, "auto");
    expect(service.getSession(id2)!.title).toBe("auto");
  });
});
