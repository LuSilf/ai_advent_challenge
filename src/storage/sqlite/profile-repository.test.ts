import { describe, test, expect, beforeEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteProfileRepository } from "./profile-repository";
import { initDb } from "../../db";

function freshDb(): string {
  const path = join(tmpdir(), `test-profile-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  initDb(path);
  return path;
}

describe("SqliteProfileRepository", () => {
  let repo: SqliteProfileRepository;

  beforeEach(() => {
    freshDb();
    repo = new SqliteProfileRepository();
  });

  test("create returns id and getById retrieves profile", () => {
    const id = repo.create({ name: "default", userName: "Алексей", language: "русский", style: "неформальный", format: "краткий", restrictions: null });
    expect(id).toBeGreaterThan(0);

    const profile = repo.getById(id);
    expect(profile).not.toBeNull();
    expect(profile!.name).toBe("default");
    expect(profile!.userName).toBe("Алексей");
    expect(profile!.language).toBe("русский");
    expect(profile!.style).toBe("неформальный");
    expect(profile!.format).toBe("краткий");
    expect(profile!.restrictions).toBeNull();
    expect(profile!.createdAt).toBeDefined();
    expect(profile!.updatedAt).toBeDefined();
  });

  test("create with minimal fields", () => {
    const id = repo.create({ name: "minimal", userName: null, language: null, style: null, format: null, restrictions: null });
    const profile = repo.getById(id);
    expect(profile!.name).toBe("minimal");
    expect(profile!.userName).toBeNull();
  });

  test("getById returns null for missing id", () => {
    expect(repo.getById(999)).toBeNull();
  });

  test("getAll returns all profiles", () => {
    repo.create({ name: "first", userName: null, language: null, style: null, format: null, restrictions: null });
    repo.create({ name: "second", userName: null, language: null, style: null, format: null, restrictions: null });
    const all = repo.getAll();
    expect(all).toHaveLength(2);
    expect(all.map((p) => p.name)).toEqual(["first", "second"]);
  });

  test("getAll returns empty array when no profiles", () => {
    expect(repo.getAll()).toEqual([]);
  });

  test("update modifies fields", () => {
    const id = repo.create({ name: "test", userName: null, language: null, style: null, format: null, restrictions: null });
    repo.update(id, { userName: "Иван", style: "формальный" });
    const updated = repo.getById(id)!;
    expect(updated.userName).toBe("Иван");
    expect(updated.style).toBe("формальный");
    expect(updated.name).toBe("test");
  });

  test("update only specified fields", () => {
    const id = repo.create({ name: "test", userName: "Алексей", language: "русский", style: null, format: null, restrictions: null });
    repo.update(id, { language: "english" });
    const profile = repo.getById(id)!;
    expect(profile.userName).toBe("Алексей");
    expect(profile.language).toBe("english");
  });

  test("delete removes profile", () => {
    const id = repo.create({ name: "test", userName: null, language: null, style: null, format: null, restrictions: null });
    expect(repo.delete(id)).toBe(true);
    expect(repo.getById(id)).toBeNull();
  });

  test("delete returns false for missing id", () => {
    expect(repo.delete(999)).toBe(false);
  });

  test("delete cascades to preferences", () => {
    const id = repo.create({ name: "test", userName: null, language: null, style: null, format: null, restrictions: null });
    repo.setPreference(id, "framework", "React");
    repo.delete(id);
    expect(repo.getPreferences(id)).toEqual([]);
  });

  // Preferences

  test("setPreference and getPreferences", () => {
    const id = repo.create({ name: "test", userName: null, language: null, style: null, format: null, restrictions: null });
    repo.setPreference(id, "framework", "React");
    repo.setPreference(id, "editor", "VSCode");

    const prefs = repo.getPreferences(id);
    expect(prefs).toHaveLength(2);
    expect(prefs.find((p) => p.key === "framework")!.value).toBe("React");
    expect(prefs.find((p) => p.key === "editor")!.value).toBe("VSCode");
  });

  test("setPreference upserts existing key", () => {
    const id = repo.create({ name: "test", userName: null, language: null, style: null, format: null, restrictions: null });
    repo.setPreference(id, "framework", "React");
    repo.setPreference(id, "framework", "Vue");

    const prefs = repo.getPreferences(id);
    expect(prefs).toHaveLength(1);
    expect(prefs[0].value).toBe("Vue");
  });

  test("getPreferences returns empty for no preferences", () => {
    const id = repo.create({ name: "test", userName: null, language: null, style: null, format: null, restrictions: null });
    expect(repo.getPreferences(id)).toEqual([]);
  });

  test("deletePreference removes preference", () => {
    const id = repo.create({ name: "test", userName: null, language: null, style: null, format: null, restrictions: null });
    repo.setPreference(id, "framework", "React");
    expect(repo.deletePreference(id, "framework")).toBe(true);
    expect(repo.getPreferences(id)).toEqual([]);
  });

  test("deletePreference returns false for missing key", () => {
    const id = repo.create({ name: "test", userName: null, language: null, style: null, format: null, restrictions: null });
    expect(repo.deletePreference(id, "nonexistent")).toBe(false);
  });
});
