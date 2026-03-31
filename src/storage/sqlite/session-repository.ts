import type { Session, SessionWithCount } from "../../domain/models";
import type { SessionRepository } from "../../domain/ports/session-repository";
import { getDb } from "../../db";

type DbSession = {
  id: number;
  title: string | null;
  context_strategy: string;
  parent_session_id: number | null;
  branch_point_message_id: number | null;
  created_at: string;
  updated_at: string;
};

type DbSessionWithCount = DbSession & { message_count: number };

function toSession(row: DbSession): Session {
  return {
    id: row.id,
    title: row.title,
    contextStrategy: row.context_strategy,
    parentSessionId: row.parent_session_id,
    branchPointMessageId: row.branch_point_message_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSessionWithCount(row: DbSessionWithCount): SessionWithCount {
  return {
    ...toSession(row),
    messageCount: row.message_count,
  };
}

export class SqliteSessionRepository implements SessionRepository {
  create(title?: string, contextStrategy?: string): number {
    const db = getDb();
    const result = db.run(
      "INSERT INTO sessions (title, context_strategy) VALUES (?, ?)",
      [title ?? null, contextStrategy ?? "full"]
    );
    return Number(result.lastInsertRowid);
  }

  getById(id: number): Session | null {
    const db = getDb();
    const row = db.query<DbSession, [number]>(
      "SELECT * FROM sessions WHERE id = ?"
    ).get(id);
    return row ? toSession(row) : null;
  }

  getAll(): SessionWithCount[] {
    const db = getDb();
    const rows = db.query<DbSessionWithCount, []>(`
      SELECT s.*, COUNT(m.id) as message_count
      FROM sessions s
      LEFT JOIN messages m ON m.session_id = s.id
      GROUP BY s.id
      ORDER BY s.updated_at DESC
    `).all();
    return rows.map(toSessionWithCount);
  }

  update(id: number, fields: Partial<Pick<Session, "title" | "contextStrategy">>): void {
    const db = getDb();
    if (fields.title !== undefined) {
      db.run("UPDATE sessions SET title = ?, updated_at = datetime('now') WHERE id = ?", [fields.title, id]);
    }
    if (fields.contextStrategy !== undefined) {
      db.run("UPDATE sessions SET context_strategy = ?, updated_at = datetime('now') WHERE id = ?", [fields.contextStrategy, id]);
    }
  }

  delete(id: number): boolean {
    const db = getDb();
    const result = db.run("DELETE FROM sessions WHERE id = ?", [id]);
    return result.changes > 0;
  }

  getLastSession(): Session | null {
    const db = getDb();
    const row = db.query<DbSession, []>(
      "SELECT * FROM sessions ORDER BY updated_at DESC LIMIT 1"
    ).get();
    return row ? toSession(row) : null;
  }

  getStrategy(sessionId: number): string {
    const db = getDb();
    const row = db.query<{ context_strategy: string }, [number]>(
      "SELECT context_strategy FROM sessions WHERE id = ?"
    ).get(sessionId);
    return row?.context_strategy ?? "full";
  }

  setStrategy(sessionId: number, strategy: string): void {
    const db = getDb();
    db.run(
      "UPDATE sessions SET context_strategy = ?, updated_at = datetime('now') WHERE id = ?",
      [strategy, sessionId]
    );
  }

  updateTitle(id: number, title: string): void {
    const db = getDb();
    db.run(
      "UPDATE sessions SET title = ?, updated_at = datetime('now') WHERE id = ?",
      [title, id]
    );
  }

  updateTitleIfNull(id: number, title: string): void {
    const db = getDb();
    db.run(
      "UPDATE sessions SET title = ? WHERE id = ? AND title IS NULL",
      [title, id]
    );
  }

  createBranch(
    parentSessionId: number,
    branchPointMessageId: number,
    title?: string,
    contextStrategy?: string
  ): number {
    const db = getDb();
    const parentStrategy = this.getStrategy(parentSessionId);
    const result = db.run(
      "INSERT INTO sessions (title, context_strategy, parent_session_id, branch_point_message_id) VALUES (?, ?, ?, ?)",
      [title ?? null, contextStrategy ?? parentStrategy, parentSessionId, branchPointMessageId]
    );
    const newSessionId = Number(result.lastInsertRowid);

    db.run(
      `INSERT INTO messages (session_id, role, content, created_at)
       SELECT ?, role, content, created_at FROM messages
       WHERE session_id = ? AND id <= ?
       ORDER BY id ASC`,
      [newSessionId, parentSessionId, branchPointMessageId]
    );

    return newSessionId;
  }

  getBranches(sessionId: number): SessionWithCount[] {
    const db = getDb();
    const session = this.getById(sessionId);
    const rootId = session?.parentSessionId ?? sessionId;

    const rows = db.query<DbSessionWithCount, [number, number]>(`
      SELECT s.*, COUNT(m.id) as message_count
      FROM sessions s
      LEFT JOIN messages m ON m.session_id = s.id
      WHERE s.parent_session_id = ? OR s.parent_session_id = (SELECT parent_session_id FROM sessions WHERE id = ?)
      GROUP BY s.id
      ORDER BY s.created_at ASC
    `).all(rootId, sessionId);
    return rows.map(toSessionWithCount);
  }
}
