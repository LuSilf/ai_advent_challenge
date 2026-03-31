import type { Fact } from "../../domain/models";
import type { FactRepository } from "../../domain/ports/fact-repository";
import { getDb } from "../../db";

export class SqliteFactRepository implements FactRepository {
  getBySession(sessionId: number): Fact[] {
    const db = getDb();
    return db.query<Fact, [number]>(
      "SELECT key, value FROM facts WHERE session_id = ? ORDER BY key ASC"
    ).all(sessionId);
  }

  set(sessionId: number, facts: Fact[]): void {
    const db = getDb();
    const stmt = db.prepare(
      "INSERT INTO facts (session_id, key, value, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(session_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
    );
    for (const fact of facts) {
      stmt.run(sessionId, fact.key, fact.value);
    }
  }

  delete(sessionId: number): void {
    const db = getDb();
    db.run("DELETE FROM facts WHERE session_id = ?", [sessionId]);
  }
}
