import type { Option } from "../../domain/models";
import type { OptionsRepository } from "../../domain/ports/options-repository";
import { getDb } from "../../db";

export class SqliteOptionsRepository implements OptionsRepository {
  get(key: string): string | null {
    const db = getDb();
    const row = db.query<{ value: string }, [string]>(
      "SELECT value FROM options WHERE key = ?"
    ).get(key);
    return row?.value ?? null;
  }

  set(key: string, value: string): void {
    const db = getDb();
    db.run(
      "INSERT INTO options (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, value]
    );
  }

  getAll(): Option[] {
    const db = getDb();
    return db.query<Option, []>(
      "SELECT key, value FROM options ORDER BY key ASC"
    ).all();
  }
}
