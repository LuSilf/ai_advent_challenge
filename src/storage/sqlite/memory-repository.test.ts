import { describe, test, expect, beforeEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteMemoryRepository } from "./memory-repository";
import { initDb } from "../../db";

function freshDb(): string {
  const path = join(tmpdir(), `test-memory-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  initDb(path);
  return path;
}

describe("SqliteMemoryRepository", () => {
  let repo: SqliteMemoryRepository;

  beforeEach(() => {
    freshDb();
    repo = new SqliteMemoryRepository();
  });

  // Long-term memory

  test("read returns empty string for empty longterm memory", () => {
    expect(repo.read("longterm")).toBe("");
  });

  test("write and read longterm memory", () => {
    repo.write("longterm", "Архитектура: гексагональная");
    expect(repo.read("longterm")).toBe("Архитектура: гексагональная");
  });

  test("write overwrites previous longterm content", () => {
    repo.write("longterm", "первая версия");
    repo.write("longterm", "вторая версия");
    expect(repo.read("longterm")).toBe("вторая версия");
  });

  test("append to empty longterm memory", () => {
    repo.append("longterm", "факт 1");
    expect(repo.read("longterm")).toBe("факт 1");
  });

  test("append to existing longterm memory", () => {
    repo.write("longterm", "факт 1");
    repo.append("longterm", "факт 2");
    const content = repo.read("longterm");
    expect(content).toContain("факт 1");
    expect(content).toContain("факт 2");
    expect(content).toContain("---");
  });

  test("clear removes longterm memory", () => {
    repo.write("longterm", "something");
    repo.clear("longterm");
    expect(repo.read("longterm")).toBe("");
  });

  // Working memory

  test("read returns empty string for empty working memory", () => {
    expect(repo.read("working")).toBe("");
  });

  test("write and read working memory", () => {
    repo.write("working", "Текущий проект: чат-бот");
    expect(repo.read("working")).toBe("Текущий проект: чат-бот");
  });

  test("working and longterm are independent", () => {
    repo.write("longterm", "long term data");
    repo.write("working", "working data");
    expect(repo.read("longterm")).toBe("long term data");
    expect(repo.read("working")).toBe("working data");
  });

  test("clear only affects specified type", () => {
    repo.write("longterm", "keep this");
    repo.write("working", "remove this");
    repo.clear("working");
    expect(repo.read("longterm")).toBe("keep this");
    expect(repo.read("working")).toBe("");
  });

  test("append to existing working memory", () => {
    repo.write("working", "fact A");
    repo.append("working", "fact B");
    const content = repo.read("working");
    expect(content).toContain("fact A");
    expect(content).toContain("fact B");
  });
});
