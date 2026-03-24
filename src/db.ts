import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Session = {
  id: number;
  title: string | null;
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
  `);
}

export function createSession(title?: string): number {
  const result = db.run(
    "INSERT INTO sessions (title) VALUES (?)",
    [title ?? null]
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
