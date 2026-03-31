import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { loadConfig, applyDbOptions } from "./config";
import type { AppConfig } from "./config";

function fail(message: string): never {
  throw new Error(message);
}

const savedEnv: Record<string, string | undefined> = {};

function setEnv(vars: Record<string, string>) {
  for (const [key, value] of Object.entries(vars)) {
    savedEnv[key] = process.env[key];
    process.env[key] = value;
  }
}

function restoreEnv() {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("loadConfig", () => {
  beforeEach(() => {
    setEnv({
      OPENAI_API_KEY: "test-key"
    });
  });

  afterEach(() => {
    restoreEnv();
  });

  test("empty args gives empty prompt (REPL mode)", () => {
    const config = loadConfig([], fail);
    expect(config.prompt).toBe("");
  });

  test("args joined as prompt", () => {
    const config = loadConfig(["hello", "world"], fail);
    expect(config.prompt).toBe("hello world");
  });

  test("parses --session flag", () => {
    const config = loadConfig(["--session", "5", "prompt text"], fail);
    expect(config.sessionId).toBe(5);
    expect(config.prompt).toBe("prompt text");
  });

  test("--session without valid number fails", () => {
    expect(() => loadConfig(["--session", "abc"], fail)).toThrow("Invalid --session value");
  });

  test("--session with negative number fails", () => {
    expect(() => loadConfig(["--session", "-1"], fail)).toThrow("Invalid --session value");
  });

  test("default historyDb", () => {
    const config = loadConfig([], fail);
    expect(config.historyDb).toBe("./data/history.db");
  });

  test("custom historyDb from env", () => {
    setEnv({ HISTORY_DB: "/tmp/custom.db" });
    const config = loadConfig([], fail);
    expect(config.historyDb).toBe("/tmp/custom.db");
  });

  test("default historyLimit is 50", () => {
    const config = loadConfig([], fail);
    expect(config.historyLimit).toBe(50);
  });

  test("custom historyLimit from env", () => {
    setEnv({ HISTORY_LIMIT: "100" });
    const config = loadConfig([], fail);
    expect(config.historyLimit).toBe(100);
  });

  test("missing API key fails", () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => loadConfig([], fail)).toThrow("Missing API key");
  });

  test("default contextStrategy is full", () => {
    const config = loadConfig([], fail);
    expect(config.contextStrategy).toBe("full");
  });

  test("custom contextStrategy from env", () => {
    setEnv({ CONTEXT_STRATEGY: "sliding" });
    const config = loadConfig([], fail);
    expect(config.contextStrategy).toBe("sliding");
  });

  test("invalid contextStrategy fails", () => {
    setEnv({ CONTEXT_STRATEGY: "invalid" });
    expect(() => loadConfig([], fail)).toThrow("Invalid CONTEXT_STRATEGY");
  });

  test("default systemPrompt is empty", () => {
    const config = loadConfig([], fail);
    expect(config.systemPrompt).toBe("");
  });

  test("systemPrompt from env overrides default", () => {
    setEnv({ OPENAI_SYSTEM_PROMPT: "custom prompt" });
    const config = loadConfig([], fail);
    expect(config.systemPrompt).toBe("custom prompt");
  });
});

describe("applyDbOptions", () => {
  function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
    return {
      prompt: "", apiKey: "k", baseUrl: "http://x", systemPrompt: "",
      effectiveTimeoutMs: 30000, debug: false, useStreaming: true,
      historyDb: "x", historyLimit: 50, contextStrategy: "full",
      ...overrides,
    };
  }

  test("applies system_prompt from DB", () => {
    const config = makeConfig();
    applyDbOptions(config, (key) => key === "system_prompt" ? "db prompt" : null);
    expect(config.systemPrompt).toBe("db prompt");
  });

  test("does not override systemPrompt when DB value is empty", () => {
    const config = makeConfig({ systemPrompt: "from env" });
    applyDbOptions(config, (key) => key === "system_prompt" ? "" : null);
    expect(config.systemPrompt).toBe("from env");
  });

  test("applies temperature from DB", () => {
    const config = makeConfig();
    applyDbOptions(config, (key) => key === "temperature" ? "0.7" : null);
    expect(config.temperature).toBe(0.7);
  });

  test("applies top_p from DB", () => {
    const config = makeConfig();
    applyDbOptions(config, (key) => key === "top_p" ? "0.9" : null);
    expect(config.topP).toBe(0.9);
  });

  test("applies debug from DB", () => {
    const config = makeConfig();
    applyDbOptions(config, (key) => key === "debug" ? "true" : null);
    expect(config.debug).toBe(true);
  });

  test("applies context_strategy from DB", () => {
    const config = makeConfig();
    applyDbOptions(config, (key) => key === "context_strategy" ? "sliding" : null);
    expect(config.contextStrategy).toBe("sliding");
  });

  test("ignores invalid temperature", () => {
    const config = makeConfig({ temperature: 0.5 });
    applyDbOptions(config, (key) => key === "temperature" ? "abc" : null);
    expect(config.temperature).toBe(0.5);
  });

  test("ignores invalid context_strategy", () => {
    const config = makeConfig();
    applyDbOptions(config, (key) => key === "context_strategy" ? "invalid" : null);
    expect(config.contextStrategy).toBe("full");
  });
});
