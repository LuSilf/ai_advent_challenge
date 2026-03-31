import type { Message } from "../../domain/models";
import type { MessageRepository } from "../../domain/ports/message-repository";
import { getDb } from "../../db";

type DbMessage = {
  id: number;
  session_id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

function toMessage(row: DbMessage): Message {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  };
}

export class SqliteMessageRepository implements MessageRepository {
  add(sessionId: number, role: "user" | "assistant", content: string): void {
    const db = getDb();
    db.run(
      "INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)",
      [sessionId, role, content]
    );
    db.run(
      "UPDATE sessions SET updated_at = datetime('now') WHERE id = ?",
      [sessionId]
    );
  }

  getBySession(sessionId: number, limit?: number): Message[] {
    const db = getDb();
    if (limit) {
      const rows = db.query<DbMessage, [number, number]>(
        "SELECT * FROM (SELECT * FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC"
      ).all(sessionId, limit);
      return rows.map(toMessage);
    }
    const rows = db.query<DbMessage, [number]>(
      "SELECT * FROM messages WHERE session_id = ? ORDER BY id ASC"
    ).all(sessionId);
    return rows.map(toMessage);
  }

  getCount(sessionId: number): number {
    const db = getDb();
    const row = db.query<{ count: number }, [number]>(
      "SELECT COUNT(*) as count FROM messages WHERE session_id = ?"
    ).get(sessionId);
    return row?.count ?? 0;
  }

  deleteBySession(sessionId: number): void {
    const db = getDb();
    db.run("DELETE FROM messages WHERE session_id = ?", [sessionId]);
  }
}
