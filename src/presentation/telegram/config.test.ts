import { describe, test, expect } from "bun:test";
import { loadTelegramConfig } from "./config";

function envFrom(map: Record<string, string | undefined>) {
  return (name: string) => map[name];
}

function collectingFail(): { fail: (message: string) => never; messages: string[] } {
  const messages: string[] = [];
  const fail = (message: string): never => {
    messages.push(message);
    throw new Error(message);
  };
  return { fail, messages };
}

describe("loadTelegramConfig", () => {
  test("returns fully populated config with defaults applied", () => {
    const env = envFrom({
      TELEGRAM_BOT_TOKEN: "123:ABC",
      TELEGRAM_ALLOWED_CHAT_IDS: "1,2,3",
    });
    const { fail } = collectingFail();
    const cfg = loadTelegramConfig(env, fail);
    expect(cfg.botToken).toBe("123:ABC");
    expect(cfg.allowedChatIdsCsv).toBe("1,2,3");
    expect(cfg.model).toBe("llama3.2:3b");
    expect(cfg.baseUrl).toBe("http://localhost:11434/v1");
    expect(cfg.timeoutMs).toBe(180_000);
    expect(cfg.maxCompletionTokens).toBe(768);
    expect(cfg.systemPrompt.length).toBeGreaterThan(0);
  });

  test("overrides apply from env", () => {
    const env = envFrom({
      TELEGRAM_BOT_TOKEN: "t",
      TELEGRAM_ALLOWED_CHAT_IDS: "7",
      TELEGRAM_MODEL: "qwen2.5-coder:3b",
      TELEGRAM_BASE_URL: "http://remote:11434/v1/",
      TELEGRAM_TIMEOUT_MS: "60000",
      TELEGRAM_MAX_TOKENS: "256",
      TELEGRAM_SYSTEM_PROMPT: "Custom prompt",
    });
    const { fail } = collectingFail();
    const cfg = loadTelegramConfig(env, fail);
    expect(cfg.model).toBe("qwen2.5-coder:3b");
    expect(cfg.baseUrl).toBe("http://remote:11434/v1");
    expect(cfg.timeoutMs).toBe(60_000);
    expect(cfg.maxCompletionTokens).toBe(256);
    expect(cfg.systemPrompt).toBe("Custom prompt");
  });

  test("OPENAI_BASE_URL does NOT leak into bot config", () => {
    const env = envFrom({
      TELEGRAM_BOT_TOKEN: "t",
      TELEGRAM_ALLOWED_CHAT_IDS: "1",
      OPENAI_BASE_URL: "https://openrouter.ai/api/v1",
    });
    const { fail } = collectingFail();
    const cfg = loadTelegramConfig(env, fail);
    expect(cfg.baseUrl).toBe("http://localhost:11434/v1");
  });

  test("fails when TELEGRAM_BOT_TOKEN is missing", () => {
    const env = envFrom({ TELEGRAM_ALLOWED_CHAT_IDS: "1" });
    const { fail, messages } = collectingFail();
    expect(() => loadTelegramConfig(env, fail)).toThrow();
    expect(messages[0]).toMatch(/TELEGRAM_BOT_TOKEN/);
  });

  test("fails when TELEGRAM_ALLOWED_CHAT_IDS is missing", () => {
    const env = envFrom({ TELEGRAM_BOT_TOKEN: "t" });
    const { fail, messages } = collectingFail();
    expect(() => loadTelegramConfig(env, fail)).toThrow();
    expect(messages[0]).toMatch(/TELEGRAM_ALLOWED_CHAT_IDS/);
  });

  test("fails on non-numeric timeout", () => {
    const env = envFrom({
      TELEGRAM_BOT_TOKEN: "t",
      TELEGRAM_ALLOWED_CHAT_IDS: "1",
      TELEGRAM_TIMEOUT_MS: "two minutes",
    });
    const { fail, messages } = collectingFail();
    expect(() => loadTelegramConfig(env, fail)).toThrow();
    expect(messages[0]).toMatch(/TELEGRAM_TIMEOUT_MS/);
  });

  test("fails on non-positive max_tokens", () => {
    const env = envFrom({
      TELEGRAM_BOT_TOKEN: "t",
      TELEGRAM_ALLOWED_CHAT_IDS: "1",
      TELEGRAM_MAX_TOKENS: "0",
    });
    const { fail, messages } = collectingFail();
    expect(() => loadTelegramConfig(env, fail)).toThrow();
    expect(messages[0]).toMatch(/TELEGRAM_MAX_TOKENS/);
  });

  test("whitespace-only required value is treated as missing", () => {
    const env = envFrom({
      TELEGRAM_BOT_TOKEN: "   ",
      TELEGRAM_ALLOWED_CHAT_IDS: "1",
    });
    const { fail, messages } = collectingFail();
    expect(() => loadTelegramConfig(env, fail)).toThrow();
    expect(messages[0]).toMatch(/TELEGRAM_BOT_TOKEN/);
  });

  test("trailing slash on base url is stripped", () => {
    const env = envFrom({
      TELEGRAM_BOT_TOKEN: "t",
      TELEGRAM_ALLOWED_CHAT_IDS: "1",
      TELEGRAM_BASE_URL: "http://localhost:11434/v1/",
    });
    const { fail } = collectingFail();
    const cfg = loadTelegramConfig(env, fail);
    expect(cfg.baseUrl).toBe("http://localhost:11434/v1");
  });
});
