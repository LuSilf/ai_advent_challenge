import { describe, test, expect, beforeEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteInvariantRepository } from "./invariant-repository";
import { initDb } from "../../db";

function freshDb(): string {
  const path = join(tmpdir(), `test-inv-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  initDb(path);
  return path;
}

describe("SqliteInvariantRepository", () => {
  let repo: SqliteInvariantRepository;

  beforeEach(() => {
    freshDb();
    repo = new SqliteInvariantRepository();
  });

  test("add returns id", () => {
    const id = repo.add("Только TypeScript");
    expect(id).toBeGreaterThan(0);
  });

  test("getAll returns all invariants", () => {
    repo.add("Только TypeScript");
    repo.add("Не использовать ORM");

    const invariants = repo.getAll();
    expect(invariants).toHaveLength(2);
    expect(invariants[0].content).toBe("Только TypeScript");
    expect(invariants[1].content).toBe("Не использовать ORM");
  });

  test("getAll returns empty when no invariants", () => {
    expect(repo.getAll()).toEqual([]);
  });

  test("delete removes invariant", () => {
    const id = repo.add("правило");
    expect(repo.delete(id)).toBe(true);
    expect(repo.getAll()).toHaveLength(0);
  });

  test("delete returns false for unknown id", () => {
    expect(repo.delete(999)).toBe(false);
  });
});
