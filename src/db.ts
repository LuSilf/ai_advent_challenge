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

    CREATE TABLE IF NOT EXISTS token_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      exchange_num INTEGER NOT NULL,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cached_tokens INTEGER DEFAULT 0,
      reasoning_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER,
      input_cost REAL,
      output_cost REAL,
      total_cost REAL,
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

// --- Token usage ---

export type TokenUsageData = {
  exchangeNum: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
};

export type TokenUsageRow = TokenUsageData & {
  id: number;
  session_id: number;
  created_at: string;
};

type TokenUsageDbRow = {
  id: number;
  session_id: number;
  exchange_num: number;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  input_cost: number;
  output_cost: number;
  total_cost: number;
  created_at: string;
};

export function saveTokenUsage(sessionId: number, data: TokenUsageData): void {
  db.run(
    `INSERT INTO token_usage (session_id, exchange_num, input_tokens, output_tokens, cached_tokens, reasoning_tokens, total_tokens, input_cost, output_cost, total_cost)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionId,
      data.exchangeNum,
      data.inputTokens,
      data.outputTokens,
      data.cachedTokens,
      data.reasoningTokens,
      data.totalTokens,
      data.inputCost,
      data.outputCost,
      data.totalCost,
    ]
  );
}

function mapTokenUsageRow(row: TokenUsageDbRow): TokenUsageRow {
  return {
    id: row.id,
    session_id: row.session_id,
    exchangeNum: row.exchange_num,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cachedTokens: row.cached_tokens,
    reasoningTokens: row.reasoning_tokens,
    totalTokens: row.total_tokens,
    inputCost: row.input_cost,
    outputCost: row.output_cost,
    totalCost: row.total_cost,
    created_at: row.created_at,
  };
}

export function getSessionTokenUsage(sessionId: number): TokenUsageRow[] {
  const rows = db.query<TokenUsageDbRow, [number]>(
    "SELECT * FROM token_usage WHERE session_id = ? ORDER BY exchange_num ASC"
  ).all(sessionId);
  return rows.map(mapTokenUsageRow);
}

export function getSessionTokenTotals(sessionId: number): { totalTokens: number; totalCost: number } {
  const row = db.query<{ total_tokens: number; total_cost: number }, [number]>(
    "SELECT COALESCE(SUM(total_tokens), 0) as total_tokens, COALESCE(SUM(total_cost), 0) as total_cost FROM token_usage WHERE session_id = ?"
  ).get(sessionId);
  return {
    totalTokens: row?.total_tokens ?? 0,
    totalCost: row?.total_cost ?? 0,
  };
}

export function getExchangeCount(sessionId: number): number {
  const row = db.query<{ count: number }, [number]>(
    "SELECT COALESCE(MAX(exchange_num), 0) as count FROM token_usage WHERE session_id = ?"
  ).get(sessionId);
  return row?.count ?? 0;
}
