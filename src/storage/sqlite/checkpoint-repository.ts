import type { CheckpointRepository } from "../../domain/ports/checkpoint-repository";
import { getDb } from "../../db";

export class SqliteCheckpointRepository implements CheckpointRepository {
  create(sessionId: number): number {
    const db = getDb();
    const lastMsg = db.query<{ id: number }, [number]>(
      "SELECT id FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 1"
    ).get(sessionId);
    if (!lastMsg) {
      throw new Error("Нет сообщений для создания checkpoint");
    }
    db.run(
      "INSERT INTO checkpoints (session_id, message_id) VALUES (?, ?)",
      [sessionId, lastMsg.id]
    );
    return lastMsg.id;
  }

  getLastBySession(sessionId: number): { id: number; messageId: number } | null {
    const db = getDb();
    const row = db.query<{ id: number; message_id: number }, [number]>(
      "SELECT id, message_id FROM checkpoints WHERE session_id = ? ORDER BY id DESC LIMIT 1"
    ).get(sessionId);
    if (!row) return null;
    return { id: row.id, messageId: row.message_id };
  }
}
