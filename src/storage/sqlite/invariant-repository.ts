import type { Invariant } from "../../domain/models";
import type { InvariantRepository } from "../../domain/ports/invariant-repository";
import { getDb } from "../../db";

type DbInvariant = {
  id: number;
  profile_id: number;
  content: string;
  created_at: string;
};

function toInvariant(row: DbInvariant): Invariant {
  return {
    id: row.id,
    profileId: row.profile_id,
    content: row.content,
    createdAt: row.created_at,
  };
}

export class SqliteInvariantRepository implements InvariantRepository {
  add(profileId: number, content: string): number {
    const db = getDb();
    const result = db.run(
      "INSERT INTO invariants (profile_id, content) VALUES (?, ?)",
      [profileId, content]
    );
    return Number(result.lastInsertRowid);
  }

  getByProfile(profileId: number): Invariant[] {
    const db = getDb();
    return db.query<DbInvariant, [number]>(
      "SELECT * FROM invariants WHERE profile_id = ? ORDER BY id ASC"
    ).all(profileId).map(toInvariant);
  }

  delete(id: number): boolean {
    const db = getDb();
    const result = db.run("DELETE FROM invariants WHERE id = ?", [id]);
    return result.changes > 0;
  }
}
