import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { loadConfig } from "./config";

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
});
