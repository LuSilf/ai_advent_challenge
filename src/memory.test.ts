import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  readLongTermMemory,
  readWorkingMemory,
  appendLongTermMemory,
  appendWorkingMemory,
  buildMemoryBlocks,
  getLongTermMemoryPath,
  getWorkingMemoryPath,
} from "./memory";

let tmpDir: string;
let savedEnv: Record<string, string | undefined>;

function makeTmpDir(): string {
  const dir = join(tmpdir(), `memory-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

beforeEach(() => {
  tmpDir = makeTmpDir();
  savedEnv = {
    MEMORY_DIR: process.env.MEMORY_DIR,
  };
  process.env.MEMORY_DIR = join(tmpDir, "global");
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("readLongTermMemory", () => {
  test("returns empty string when file does not exist", () => {
    expect(readLongTermMemory()).toBe("");
  });

  test("reads content from file", () => {
    const path = getLongTermMemoryPath();
    mkdirSync(join(tmpDir, "global"), { recursive: true });
    writeFileSync(path, "user prefers dark mode");
    expect(readLongTermMemory()).toBe("user prefers dark mode");
  });
});

describe("readWorkingMemory", () => {
  test("returns empty string when file does not exist", () => {
    // cwd's .ai/memory.md likely doesn't exist in tmp
    process.chdir(tmpDir);
    expect(readWorkingMemory()).toBe("");
  });

  test("reads content from .ai/memory.md", () => {
    process.chdir(tmpDir);
    mkdirSync(join(tmpDir, ".ai"), { recursive: true });
    writeFileSync(join(tmpDir, ".ai/memory.md"), "project uses monorepo");
    expect(readWorkingMemory()).toBe("project uses monorepo");
  });
});

describe("appendLongTermMemory", () => {
  test("creates file and dirs on first write", () => {
    appendLongTermMemory("first entry");
    const content = readFileSync(getLongTermMemoryPath(), "utf-8");
    expect(content).toBe("first entry");
  });

  test("appends with separator on second write", () => {
    appendLongTermMemory("entry 1");
    appendLongTermMemory("entry 2");
    const content = readFileSync(getLongTermMemoryPath(), "utf-8");
    expect(content).toBe("entry 1\n\n---\n\nentry 2");
  });
});

describe("appendWorkingMemory", () => {
  test("creates .ai/memory.md on first write", () => {
    process.chdir(tmpDir);
    appendWorkingMemory("arch: microservices");
    const content = readFileSync(getWorkingMemoryPath(), "utf-8");
    expect(content).toBe("arch: microservices");
  });

  test("appends with separator", () => {
    process.chdir(tmpDir);
    appendWorkingMemory("fact 1");
    appendWorkingMemory("fact 2");
    const content = readFileSync(getWorkingMemoryPath(), "utf-8");
    expect(content).toBe("fact 1\n\n---\n\nfact 2");
  });
});

describe("buildMemoryBlocks", () => {
  test("returns empty string when no memory files", () => {
    process.chdir(tmpDir);
    expect(buildMemoryBlocks()).toBe("");
  });

  test("includes only long-term when working is empty", () => {
    process.chdir(tmpDir);
    appendLongTermMemory("global rule");
    const blocks = buildMemoryBlocks();
    expect(blocks).toBe("[Долговременная память]\nglobal rule");
  });

  test("includes only working when long-term is empty", () => {
    process.chdir(tmpDir);
    appendWorkingMemory("project fact");
    const blocks = buildMemoryBlocks();
    expect(blocks).toBe("[Рабочая память проекта]\nproject fact");
  });

  test("includes both layers with long-term first", () => {
    process.chdir(tmpDir);
    appendLongTermMemory("global");
    appendWorkingMemory("project");
    const blocks = buildMemoryBlocks();
    expect(blocks).toBe("[Долговременная память]\nglobal\n\n[Рабочая память проекта]\nproject");
  });
});
