import { describe, test, expect, beforeEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteOptionsRepository } from "./options-repository";
import { initDb } from "../../db";

function freshDb(): string {
  const path = join(tmpdir(), `test-opts-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  initDb(path);
  return path;
}

describe("SqliteOptionsRepository", () => {
  let repo: SqliteOptionsRepository;

  beforeEach(() => {
    freshDb();
    repo = new SqliteOptionsRepository();
  });

  test("get returns default memory_interval", () => {
    expect(repo.get("memory_interval")).toBe("5");
  });

  test("get returns null for unknown key", () => {
    expect(repo.get("unknown_key")).toBeNull();
  });

  test("set creates new option", () => {
    repo.set("new_key", "new_value");
    expect(repo.get("new_key")).toBe("new_value");
  });

  test("set updates existing option", () => {
    repo.set("memory_interval", "10");
    expect(repo.get("memory_interval")).toBe("10");
  });

  test("getAll returns all options", () => {
    const opts = repo.getAll();
    expect(opts.length).toBeGreaterThanOrEqual(1);
    const keys = opts.map((o) => o.key);
    expect(keys).toContain("memory_interval");
  });
});
