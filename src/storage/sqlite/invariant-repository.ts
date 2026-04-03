import type { Invariant } from "../../domain/models";
import type { InvariantRepository } from "../../domain/ports/invariant-repository";
import { getDb } from "../../db";

type DbInvariant = {
  id: number;
  content: string;
  created_at: string;
};

function toInvariant(row: DbInvariant): Invariant {
  return {
    id: row.id,
    content: row.content,
    createdAt: row.created_at,
  };
}

export class SqliteInvariantRepository implements InvariantRepository {
  add(content: string): number {
    const db = getDb();
    const result = db.run(
      "INSERT INTO invariants (content) VALUES (?)",
      [content]
    );
    return Number(result.lastInsertRowid);
  }

  getAll(): Invariant[] {
    const db = getDb();
    return db.query<DbInvariant, []>(
      "SELECT * FROM invariants ORDER BY id ASC"
    ).all().map(toInvariant);
  }

  delete(id: number): boolean {
    const db = getDb();
    const result = db.run("DELETE FROM invariants WHERE id = ?", [id]);
    return result.changes > 0;
  }
}
