import { describe, test, expect, beforeEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteInvariantRepository } from "./invariant-repository";
import { SqliteProfileRepository } from "./profile-repository";
import { initDb } from "../../db";

function freshDb(): string {
  const path = join(tmpdir(), `test-inv-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  initDb(path);
  return path;
}

describe("SqliteInvariantRepository", () => {
  let repo: SqliteInvariantRepository;
  let profileRepo: SqliteProfileRepository;
  let profileId: number;

  beforeEach(() => {
    freshDb();
    repo = new SqliteInvariantRepository();
    profileRepo = new SqliteProfileRepository();
    profileId = profileRepo.create({
      name: "test",
      userName: null,
      language: null,
      style: null,
      format: null,
      restrictions: null,
    });
  });

  test("add returns id", () => {
    const id = repo.add(profileId, "Только TypeScript");
    expect(id).toBeGreaterThan(0);
  });

  test("getByProfile returns invariants for profile", () => {
    repo.add(profileId, "Только TypeScript");
    repo.add(profileId, "Не использовать ORM");

    const invariants = repo.getByProfile(profileId);
    expect(invariants).toHaveLength(2);
    expect(invariants[0].content).toBe("Только TypeScript");
    expect(invariants[1].content).toBe("Не использовать ORM");
    expect(invariants[0].profileId).toBe(profileId);
  });

  test("getByProfile returns empty for unknown profile", () => {
    expect(repo.getByProfile(999)).toEqual([]);
  });

  test("delete removes invariant", () => {
    const id = repo.add(profileId, "правило");
    expect(repo.delete(id)).toBe(true);
    expect(repo.getByProfile(profileId)).toHaveLength(0);
  });

  test("delete returns false for unknown id", () => {
    expect(repo.delete(999)).toBe(false);
  });

  test("cascade delete with profile", () => {
    repo.add(profileId, "правило 1");
    repo.add(profileId, "правило 2");
    profileRepo.delete(profileId);
    expect(repo.getByProfile(profileId)).toEqual([]);
  });
});
