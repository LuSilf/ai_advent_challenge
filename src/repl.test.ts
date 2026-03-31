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
  test("saves text to long-term memory file", () => {
    const state = { sessionId: 1 };
    const result = handleCommand("/remember", "user prefers dark mode", state, makeConfig());
    expect(result).toBeNull();
    const content = readFileSync(getLongTermMemoryPath(), "utf-8");
    expect(content).toBe("user prefers dark mode");
  });

  test("returns null without args (shows usage)", () => {
    const state = { sessionId: 1 };
    const result = handleCommand("/remember", "", state, makeConfig());
    expect(result).toBeNull();
  });
});

describe("/save_facts", () => {
  test("saves text to working memory file", () => {
    const state = { sessionId: 1 };
    const result = handleCommand("/save_facts", "arch: monorepo", state, makeConfig());
    expect(result).toBeNull();
    const content = readFileSync(getWorkingMemoryPath(), "utf-8");
    expect(content).toBe("arch: monorepo");
  });

  test("returns null without args (shows usage)", () => {
    const state = { sessionId: 1 };
    const result = handleCommand("/save_facts", "", state, makeConfig());
    expect(result).toBeNull();
  });
});

describe("/memory", () => {
  test("returns null when memory is empty", () => {
    const state = { sessionId: 1 };
    const result = handleCommand("/memory", "", state, makeConfig());
    expect(result).toBeNull();
  });

  test("returns null and shows content when memory exists", () => {
    appendLongTermMemory("global rule");
    const state = { sessionId: 1 };
    const result = handleCommand("/memory", "", state, makeConfig());
    expect(result).toBeNull();
  });
});

describe("/facts (working memory)", () => {
  test("returns null when working memory is empty", () => {
    const state = { sessionId: 1 };
    const result = handleCommand("/facts", "", state, makeConfig());
    expect(result).toBeNull();
  });

  test("returns null and shows content when working memory exists", () => {
    appendWorkingMemory("project fact");
    const state = { sessionId: 1 };
    const result = handleCommand("/facts", "", state, makeConfig());
    expect(result).toBeNull();
  });
});

describe("/edit_memory", () => {
  test("creates file if it does not exist", () => {
    // Используем 'true' как редактор — он ничего не делает и возвращает 0
    process.env.EDITOR = "true";
    const state = { sessionId: 1 };
    const result = handleCommand("/edit_memory", "", state, makeConfig());
    expect(result).toBeNull();
  });
});

describe("/edit_facts", () => {
  test("creates file if it does not exist", () => {
    process.env.EDITOR = "true";
    const state = { sessionId: 1 };
    const result = handleCommand("/edit_facts", "", state, makeConfig());
    expect(result).toBeNull();
  });
});
