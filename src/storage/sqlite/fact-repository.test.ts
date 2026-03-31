import { describe, test, expect, beforeEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteFactRepository } from "./fact-repository";
import { SqliteSessionRepository } from "./session-repository";
import { initDb } from "../../db";

function freshDb(): string {
  const path = join(tmpdir(), `test-fact-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  initDb(path);
  return path;
}

describe("SqliteFactRepository", () => {
  let repo: SqliteFactRepository;
  let sessionRepo: SqliteSessionRepository;
  let sessionId: number;

  beforeEach(() => {
    freshDb();
    repo = new SqliteFactRepository();
    sessionRepo = new SqliteSessionRepository();
    sessionId = sessionRepo.create();
  });

  test("getBySession returns empty for new session", () => {
    expect(repo.getBySession(sessionId)).toEqual([]);
  });

  test("set inserts and updates facts", () => {
    repo.set(sessionId, [
      { key: "цель", value: "тестирование" },
      { key: "язык", value: "TypeScript" },
    ]);
    const facts = repo.getBySession(sessionId);
    expect(facts).toHaveLength(2);
    expect(facts[0]).toEqual({ key: "цель", value: "тестирование" });
    expect(facts[1]).toEqual({ key: "язык", value: "TypeScript" });

    // upsert
    repo.set(sessionId, [{ key: "язык", value: "Python" }]);
    const updated = repo.getBySession(sessionId);
    expect(updated.find((f) => f.key === "язык")!.value).toBe("Python");
  });

  test("delete removes all facts", () => {
    repo.set(sessionId, [{ key: "a", value: "b" }]);
    repo.delete(sessionId);
    expect(repo.getBySession(sessionId)).toEqual([]);
  });

  test("facts cascade deleted with session", () => {
    repo.set(sessionId, [{ key: "a", value: "b" }]);
    sessionRepo.delete(sessionId);
    expect(repo.getBySession(sessionId)).toEqual([]);
  });
});
