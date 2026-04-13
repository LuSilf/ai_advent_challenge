import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as sqliteVec from "sqlite-vec";

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

export type Model = {
  id: string;
  name: string;
  input_price: number;
  output_price: number;
  context_size: number;
};

export type ModelRole = {
  role: string;
  model_id: string;
};

let db: Database;

export function getDb(): Database {
  return db;
}

export function initDb(dbPath: string): void {
  mkdirSync(dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  sqliteVec.load(db);
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

    CREATE TABLE IF NOT EXISTS models (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      input_price REAL NOT NULL,
      output_price REAL NOT NULL,
      context_size INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS model_roles (
      role TEXT PRIMARY KEY,
      model_id TEXT NOT NULL REFERENCES models(id)
    );

    CREATE TABLE IF NOT EXISTS options (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      user_name TEXT,
      language TEXT,
      style TEXT,
      format TEXT,
      restrictions TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS profile_preferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      UNIQUE(profile_id, key)
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      phase TEXT NOT NULL DEFAULT 'planning' CHECK (phase IN ('planning', 'execution', 'validation', 'done', 'paused', 'cancelled')),
      previous_phase TEXT CHECK (previous_phase IN ('planning', 'execution', 'validation') OR previous_phase IS NULL),
      summary TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS task_transitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      from_phase TEXT CHECK (from_phase IN ('planning', 'execution', 'validation', 'done', 'paused', 'cancelled') OR from_phase IS NULL),
      to_phase TEXT NOT NULL CHECK (to_phase IN ('planning', 'execution', 'validation', 'done', 'paused', 'cancelled')),
      triggered_by TEXT NOT NULL CHECK (triggered_by IN ('llm', 'system', 'user')),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS mcp_servers (
      name TEXT PRIMARY KEY,
      command TEXT NOT NULL,
      args TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS long_term_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS working_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      cron_expression TEXT NOT NULL,
      prompt TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      last_run_at TEXT,
      next_run_at TEXT
    );

    CREATE TABLE IF NOT EXISTS schedule_executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('success', 'error')),
      result TEXT,
      error TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      tokens_used INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      strategy TEXT NOT NULL CHECK (strategy IN ('fixed', 'structural')),
      source TEXT NOT NULL,
      title TEXT,
      section TEXT,
      chunk_index INTEGER NOT NULL,
      char_start INTEGER NOT NULL,
      char_end INTEGER NOT NULL,
      text TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_strategy_source ON chunks(strategy, source);
  `);

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vectors USING vec0(
      chunk_id INTEGER PRIMARY KEY,
      embedding float[768]
    );
  `);

  // Предзаполнение моделей
  const seedModels: Model[] = [
    { id: "openai/gpt-5-nano", name: "GPT-5 Nano", input_price: 0.05, output_price: 0.40, context_size: 400_000 },
    { id: "openai/gpt-5.4-nano", name: "GPT-5.4 Nano", input_price: 0.20, output_price: 1.25, context_size: 400_000 },
    { id: "google/gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite", input_price: 0.10, output_price: 0.40, context_size: 1_048_576 },
    { id: "qwen/qwen3-235b-a22b-2507", name: "Qwen3 235B A22B", input_price: 0.071, output_price: 0.10, context_size: 262_144 },
    { id: "qwen/qwen3.5-flash-02-23", name: "Qwen3.5 Flash", input_price: 0.065, output_price: 0.26, context_size: 1_000_000 },
    { id: "deepseek/deepseek-v3.2", name: "DeepSeek V3.2", input_price: 0.26, output_price: 0.38, context_size: 163_840 },
    { id: "xiaomi/mimo-v2-flash", name: "MiMo V2 Flash", input_price: 0.09, output_price: 0.29, context_size: 262_144 },
  ];

  const insertModel = db.prepare(
    "INSERT OR IGNORE INTO models (id, name, input_price, output_price, context_size) VALUES (?, ?, ?, ?, ?)"
  );
  for (const m of seedModels) {
    insertModel.run(m.id, m.name, m.input_price, m.output_price, m.context_size);
  }

  // Дефолтные маппинги ролей
  const defaultRoles: ModelRole[] = [
    { role: "chat", model_id: "openai/gpt-5-nano" },
    { role: "title", model_id: "openai/gpt-5-nano" },
    { role: "facts", model_id: "openai/gpt-5-nano" },
  ];

  const insertRole = db.prepare(
    "INSERT OR IGNORE INTO model_roles (role, model_id) VALUES (?, ?)"
  );
  for (const r of defaultRoles) {
    insertRole.run(r.role, r.model_id);
  }

  // Дефолтные опции
  const defaultOptions: { key: string; value: string }[] = [
    { key: "memory_interval", value: "15" },
    { key: "system_prompt", value: "Отвечай кратко и по делу" },
    { key: "temperature", value: "0.3" },
    { key: "top_p", value: "" },
    { key: "debug", value: "false" },
    { key: "context_strategy", value: "full" },
  ];
  const insertOption = db.prepare(
    "INSERT OR IGNORE INTO options (key, value) VALUES (?, ?)"
  );
  for (const o of defaultOptions) {
    insertOption.run(o.key, o.value);
  }

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

// --- Cost calculation ---

export type CostInfo = {
  cost: number;
  inputTokens: number;
  outputTokens: number;
};

export function calculateCost(model: Model, inputTokens: number, outputTokens: number): CostInfo {
  const cost = (inputTokens / 1_000_000) * model.input_price + (outputTokens / 1_000_000) * model.output_price;
  return { cost, inputTokens, outputTokens };
}

export function formatCost(info: CostInfo): string {
  const costStr = info.cost < 0.01
    ? `$${info.cost.toFixed(6)}`
    : `$${info.cost.toFixed(4)}`;
  return `💰 ${costStr} (${info.inputTokens} in / ${info.outputTokens} out)`;
}

// --- Models ---

export function getModel(id: string): Model | null {
  return db.query<Model, [string]>(
    "SELECT * FROM models WHERE id = ?"
  ).get(id) ?? null;
}

export function listModels(): Model[] {
  return db.query<Model, []>(
    "SELECT * FROM models ORDER BY id ASC"
  ).all();
}

// --- Model Roles ---

export function getModelForRole(role: string): Model | null {
  return db.query<Model, [string]>(
    "SELECT m.* FROM models m JOIN model_roles r ON r.model_id = m.id WHERE r.role = ?"
  ).get(role) ?? null;
}

export function listModelRoles(): (ModelRole & { model_name: string })[] {
  return db.query<ModelRole & { model_name: string }, []>(
    "SELECT r.role, r.model_id, m.name as model_name FROM model_roles r JOIN models m ON r.model_id = m.id ORDER BY r.role ASC"
  ).all();
}

export function setModelForRole(role: string, modelId: string): void {
  const model = getModel(modelId);
  if (!model) {
    throw new Error(`Модель "${modelId}" не найдена`);
  }
  db.run(
    "INSERT INTO model_roles (role, model_id) VALUES (?, ?) ON CONFLICT(role) DO UPDATE SET model_id = excluded.model_id",
    [role, modelId]
  );
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

// --- Options ---

export type Option = { key: string; value: string };

export function getOption(key: string): string | null {
  const row = db.query<{ value: string }, [string]>(
    "SELECT value FROM options WHERE key = ?"
  ).get(key);
  return row?.value ?? null;
}

export function setOption(key: string, value: string): void {
  db.run(
    "INSERT INTO options (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value]
  );
}

export function listOptions(): Option[] {
  return db.query<Option, []>(
    "SELECT key, value FROM options ORDER BY key ASC"
  ).all();
}
