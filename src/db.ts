import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Session = {
  id: number;
  title: string | null;
  context_strategy: string;
  parent_session_id: number | null;
  branch_point_message_id: number | null;
  created_at: string;
  updated_at: string;
};

export type SessionWithCount = Session & { message_count: number };

export type Message = {
  id: number;
  session_id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

let db: Database;

export function initDb(dbPath: string): void {
  mkdirSync(dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      context_strategy TEXT NOT NULL DEFAULT 'full',
      parent_session_id INTEGER REFERENCES sessions(id),
      branch_point_message_id INTEGER REFERENCES messages(id),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(session_id, key)
    );

    CREATE TABLE IF NOT EXISTS checkpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      message_id INTEGER NOT NULL REFERENCES messages(id),
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Миграция: добавляем новые поля если их нет (для существующих БД)
  try {
    db.exec("ALTER TABLE sessions ADD COLUMN context_strategy TEXT NOT NULL DEFAULT 'full'");
  } catch { /* уже существует */ }
  try {
    db.exec("ALTER TABLE sessions ADD COLUMN parent_session_id INTEGER REFERENCES sessions(id)");
  } catch { /* уже существует */ }
  try {
    db.exec("ALTER TABLE sessions ADD COLUMN branch_point_message_id INTEGER REFERENCES messages(id)");
  } catch { /* уже существует */ }
}

export function createSession(title?: string, contextStrategy?: string): number {
  const result = db.run(
    "INSERT INTO sessions (title, context_strategy) VALUES (?, ?)",
    [title ?? null, contextStrategy ?? "full"]
  );
  return Number(result.lastInsertRowid);
}

export function getLastSession(): Session | null {
  return db.query<Session, []>(
    "SELECT * FROM sessions ORDER BY updated_at DESC LIMIT 1"
  ).get() ?? null;
}

export function getSession(id: number): Session | null {
  return db.query<Session, [number]>(
    "SELECT * FROM sessions WHERE id = ?"
  ).get(id) ?? null;
}

export function listSessions(): SessionWithCount[] {
  return db.query<SessionWithCount, []>(`
    SELECT s.*, COUNT(m.id) as message_count
    FROM sessions s
    LEFT JOIN messages m ON m.session_id = s.id
    GROUP BY s.id
    ORDER BY s.updated_at DESC
  `).all();
}

export function deleteSession(id: number): boolean {
  const result = db.run("DELETE FROM sessions WHERE id = ?", [id]);
  return result.changes > 0;
}

export function renameSession(id: number, title: string): void {
  db.run(
    "UPDATE sessions SET title = ?, updated_at = datetime('now') WHERE id = ?",
    [title, id]
  );
}

export function updateSessionTitle(id: number, title: string): void {
  db.run(
    "UPDATE sessions SET title = ? WHERE id = ? AND title IS NULL",
    [title, id]
  );
}

export function addMessage(sessionId: number, role: "user" | "assistant", content: string): void {
  db.run(
    "INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)",
    [sessionId, role, content]
  );
  db.run(
    "UPDATE sessions SET updated_at = datetime('now') WHERE id = ?",
    [sessionId]
  );
}

export function getMessages(sessionId: number, limit?: number): Message[] {
  if (limit) {
    const rows = db.query<Message, [number, number]>(
      "SELECT * FROM (SELECT * FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC"
    ).all(sessionId, limit);
    return rows;
  }
  return db.query<Message, [number]>(
    "SELECT * FROM messages WHERE session_id = ? ORDER BY id ASC"
  ).all(sessionId);
}

export function getMessageCount(sessionId: number): number {
  const row = db.query<{ count: number }, [number]>(
    "SELECT COUNT(*) as count FROM messages WHERE session_id = ?"
  ).get(sessionId);
  return row?.count ?? 0;
}

export function clearMessages(sessionId: number): void {
  db.run("DELETE FROM messages WHERE session_id = ?", [sessionId]);
}

// --- Context strategy ---

export function getSessionStrategy(sessionId: number): string {
  const row = db.query<{ context_strategy: string }, [number]>(
    "SELECT context_strategy FROM sessions WHERE id = ?"
  ).get(sessionId);
  return row?.context_strategy ?? "full";
}

export function setSessionStrategy(sessionId: number, strategy: string): void {
  db.run(
    "UPDATE sessions SET context_strategy = ?, updated_at = datetime('now') WHERE id = ?",
    [strategy, sessionId]
  );
}

// --- Facts ---

export type Fact = { key: string; value: string };

export function getFacts(sessionId: number): Fact[] {
  return db.query<Fact, [number]>(
    "SELECT key, value FROM facts WHERE session_id = ? ORDER BY key ASC"
  ).all(sessionId);
}

export function upsertFacts(sessionId: number, facts: Fact[]): void {
  const stmt = db.prepare(
    "INSERT INTO facts (session_id, key, value, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(session_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
  );
  for (const fact of facts) {
    stmt.run(sessionId, fact.key, fact.value);
  }
}

export function clearFacts(sessionId: number): void {
  db.run("DELETE FROM facts WHERE session_id = ?", [sessionId]);
}

// --- Checkpoints & Branching ---

export function createCheckpoint(sessionId: number): number {
  const lastMsg = db.query<{ id: number }, [number]>(
    "SELECT id FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 1"
  ).get(sessionId);
  if (!lastMsg) {
    throw new Error("Нет сообщений для создания checkpoint");
  }
  const result = db.run(
    "INSERT INTO checkpoints (session_id, message_id) VALUES (?, ?)",
    [sessionId, lastMsg.id]
  );
  return lastMsg.id;
}

export function getLastCheckpoint(sessionId: number): { id: number; message_id: number } | null {
  return db.query<{ id: number; message_id: number }, [number]>(
    "SELECT id, message_id FROM checkpoints WHERE session_id = ? ORDER BY id DESC LIMIT 1"
  ).get(sessionId) ?? null;
}

export function createBranch(
  parentSessionId: number,
  branchPointMessageId: number,
  title?: string,
  contextStrategy?: string
): number {
  const parentStrategy = getSessionStrategy(parentSessionId);
  const result = db.run(
    "INSERT INTO sessions (title, context_strategy, parent_session_id, branch_point_message_id) VALUES (?, ?, ?, ?)",
    [title ?? null, contextStrategy ?? parentStrategy, parentSessionId, branchPointMessageId]
  );
  const newSessionId = Number(result.lastInsertRowid);

  // Копируем сообщения до checkpoint включительно
  db.run(
    `INSERT INTO messages (session_id, role, content, created_at)
     SELECT ?, role, content, created_at FROM messages
     WHERE session_id = ? AND id <= ?
     ORDER BY id ASC`,
    [newSessionId, parentSessionId, branchPointMessageId]
  );

  return newSessionId;
}

export function listBranches(sessionId: number): SessionWithCount[] {
  // Находим корневую сессию
  const session = getSession(sessionId);
  const rootId = session?.parent_session_id ?? sessionId;

  return db.query<SessionWithCount, [number, number]>(`
    SELECT s.*, COUNT(m.id) as message_count
    FROM sessions s
    LEFT JOIN messages m ON m.session_id = s.id
    WHERE s.parent_session_id = ? OR s.parent_session_id = (SELECT parent_session_id FROM sessions WHERE id = ?)
    GROUP BY s.id
    ORDER BY s.created_at ASC
  `).all(rootId, sessionId);
}
