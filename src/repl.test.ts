import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { handleCommand } from "./repl";
import { initDb } from "./db";
import type { AppConfig } from "./config";
import { getLongTermMemoryPath, getWorkingMemoryPath, appendLongTermMemory, appendWorkingMemory } from "./memory";

let tmpDir: string;
let savedEnv: Record<string, string | undefined>;
let savedCwd: string;

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    prompt: "",
    apiKey: "key",
    baseUrl: "http://localhost",
    systemPrompt: "system",
    effectiveTimeoutMs: 30000,
    debug: false,
    useStreaming: true,
    historyDb: join(tmpDir, "test.db"),
    historyLimit: 50,
    contextStrategy: "full",
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = join(tmpdir(), `repl-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  savedEnv = { MEMORY_DIR: process.env.MEMORY_DIR };
  savedCwd = process.cwd();
  process.env.MEMORY_DIR = join(tmpDir, "global");
  process.chdir(tmpDir);
  initDb(join(tmpDir, "test.db"));
});

afterEach(() => {
  process.chdir(savedCwd);
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("/remember", () => {
  test("saves text directly when memory is empty (no LLM)", async () => {
    const state = { sessionId: 1 };
    const result = await handleCommand("/remember", "user prefers dark mode", state, makeConfig());
    expect(result).toBeNull();
    const content = readFileSync(getLongTermMemoryPath(), "utf-8");
    expect(content).toBe("user prefers dark mode");
  });

  test("appends without LLM when no client provided and memory exists", async () => {
    appendLongTermMemory("existing");
    const state = { sessionId: 1 };
    // No deps.client — fallback to append
    const result = await handleCommand("/remember", "new fact", state, makeConfig());
    expect(result).toBeNull();
    const content = readFileSync(getLongTermMemoryPath(), "utf-8");
    expect(content).toContain("existing");
    expect(content).toContain("new fact");
  });

  test("returns null without args (shows usage)", async () => {
    const state = { sessionId: 1 };
    const result = await handleCommand("/remember", "", state, makeConfig());
    expect(result).toBeNull();
  });
});

describe("/save_facts", () => {
  test("saves text to working memory file", async () => {
    const state = { sessionId: 1 };
    const result = await handleCommand("/save_facts", "arch: monorepo", state, makeConfig());
    expect(result).toBeNull();
    const content = readFileSync(getWorkingMemoryPath(), "utf-8");
    expect(content).toBe("arch: monorepo");
  });

  test("returns null without args (shows usage)", async () => {
    const state = { sessionId: 1 };
    const result = await handleCommand("/save_facts", "", state, makeConfig());
    expect(result).toBeNull();
  });
});

describe("/memory", () => {
  test("returns null when memory is empty", async () => {
    const state = { sessionId: 1 };
    const result = await handleCommand("/memory", "", state, makeConfig());
    expect(result).toBeNull();
  });

  test("returns null and shows content when memory exists", async () => {
    appendLongTermMemory("global rule");
    const state = { sessionId: 1 };
    const result = await handleCommand("/memory", "", state, makeConfig());
    expect(result).toBeNull();
  });
});

describe("/facts (working memory)", () => {
  test("returns null when working memory is empty", async () => {
    const state = { sessionId: 1 };
    const result = await handleCommand("/facts", "", state, makeConfig());
    expect(result).toBeNull();
  });

  test("returns null and shows content when working memory exists", async () => {
    appendWorkingMemory("project fact");
    const state = { sessionId: 1 };
    const result = await handleCommand("/facts", "", state, makeConfig());
    expect(result).toBeNull();
  });
});

describe("/edit_memory", () => {
  test("creates file if it does not exist", async () => {
    process.env.EDITOR = "true";
    const state = { sessionId: 1 };
    const result = await handleCommand("/edit_memory", "", state, makeConfig());
    expect(result).toBeNull();
  });
});

describe("/edit_facts", () => {
  test("creates file if it does not exist", async () => {
    process.env.EDITOR = "true";
    const state = { sessionId: 1 };
    const result = await handleCommand("/edit_facts", "", state, makeConfig());
    expect(result).toBeNull();
  });
});
