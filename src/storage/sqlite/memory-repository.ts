import type { MemoryRepository, MemoryType } from "../../domain/ports/memory-repository";
import { getDb } from "../../db";

const SEPARATOR = "\n\n---\n\n";

function tableName(type: MemoryType): string {
  return type === "longterm" ? "long_term_memories" : "working_memories";
}

export class SqliteMemoryRepository implements MemoryRepository {
  read(type: MemoryType): string {
    const db = getDb();
    const rows = db.query<{ content: string }, []>(
      `SELECT content FROM ${tableName(type)} ORDER BY id ASC`
    ).all();
    return rows.map((r) => r.content).join(SEPARATOR);
  }

  write(type: MemoryType, content: string): void {
    const db = getDb();
    const table = tableName(type);
    db.run(`DELETE FROM ${table}`);
    db.run(`INSERT INTO ${table} (content) VALUES (?)`, [content]);
  }

  append(type: MemoryType, content: string): void {
    const db = getDb();
    db.run(`INSERT INTO ${tableName(type)} (content) VALUES (?)`, [content]);
  }

  clear(type: MemoryType): void {
    const db = getDb();
    db.run(`DELETE FROM ${tableName(type)}`);
  }
}
