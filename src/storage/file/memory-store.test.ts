import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync, readFileSync } from "node:fs";
import { FileMemoryStore } from "./memory-store";

describe("FileMemoryStore", () => {
  let store: FileMemoryStore;
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `test-memory-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    store = new FileMemoryStore(
      join(tempDir, "memory.md"),
      join(tempDir, "working.md"),
    );
  });

  afterEach(() => {
    try { rmSync(tempDir, { recursive: true }); } catch {}
  });

  test("read returns empty string for non-existent file", () => {
    expect(store.read("longterm")).toBe("");
    expect(store.read("working")).toBe("");
  });

  test("write and read longterm", () => {
    store.write("longterm", "global facts");
    expect(store.read("longterm")).toBe("global facts");
  });

  test("write and read working", () => {
    store.write("working", "project facts");
    expect(store.read("working")).toBe("project facts");
  });

  test("append to empty creates new content", () => {
    store.append("longterm", "first fact");
    expect(store.read("longterm")).toBe("first fact");
  });

  test("append to existing adds separator", () => {
    store.write("longterm", "existing");
    store.append("longterm", "new");
    const content = store.read("longterm");
    expect(content).toContain("existing");
    expect(content).toContain("---");
    expect(content).toContain("new");
  });

  test("write overwrites existing content", () => {
    store.write("working", "old");
    store.write("working", "new");
    expect(store.read("working")).toBe("new");
  });

  test("getPath returns correct paths", () => {
    expect(store.getPath("longterm")).toBe(join(tempDir, "memory.md"));
    expect(store.getPath("working")).toBe(join(tempDir, "working.md"));
  });
});
