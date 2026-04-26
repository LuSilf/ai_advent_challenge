import { describe, test, expect } from "bun:test";
import { loadServerConfig } from "./server-config";

const REQUIRED_ENV: Record<string, string> = { LLM_SERVICE_API_KEYS: "alice:sk-aaa" };

function envFrom(map: Record<string, string | undefined>) {
  const merged = { ...REQUIRED_ENV, ...map };
  return (name: string) => merged[name];
}

function envWithoutRequired(map: Record<string, string | undefined>) {
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

describe("loadServerConfig", () => {
  test("returns defaults when only mandatory env is set", () => {
    const env = envFrom({});
    const { fail } = collectingFail();
    const cfg = loadServerConfig(env, fail);
    expect(cfg.host).toBe("0.0.0.0");
    expect(cfg.port).toBe(8080);
    expect(cfg.ollamaBaseUrl).toBe("http://localhost:11434");
    expect(cfg.requestTimeoutMs).toBe(180_000);
    expect(cfg.allowedModels).toEqual(["llama3.2:3b", "qwen2.5-coder:7b"]);
    expect(cfg.apiKeys.size).toBe(1);
    expect(cfg.apiKeys.get("alice")).toBe("sk-aaa");
  });

  test("overrides apply from env", () => {
    const env = envFrom({
      LLM_SERVICE_HOST: "127.0.0.1",
      LLM_SERVICE_PORT: "9000",
      OLLAMA_BASE_URL: "http://other:11434/",
      LLM_SERVICE_TIMEOUT_MS: "60000",
    });
    const { fail } = collectingFail();
    const cfg = loadServerConfig(env, fail);
    expect(cfg.host).toBe("127.0.0.1");
    expect(cfg.port).toBe(9000);
    expect(cfg.ollamaBaseUrl).toBe("http://other:11434");
    expect(cfg.requestTimeoutMs).toBe(60_000);
  });

  test("trailing slash on ollama base url is stripped", () => {
    const env = envFrom({ OLLAMA_BASE_URL: "http://localhost:11434/" });
    const { fail } = collectingFail();
    const cfg = loadServerConfig(env, fail);
    expect(cfg.ollamaBaseUrl).toBe("http://localhost:11434");
  });

  test("fails on non-numeric port", () => {
    const env = envFrom({ LLM_SERVICE_PORT: "eighty" });
    const { fail, messages } = collectingFail();
    expect(() => loadServerConfig(env, fail)).toThrow();
    expect(messages[0]).toMatch(/LLM_SERVICE_PORT/);
  });

  test("fails on zero port", () => {
    const env = envFrom({ LLM_SERVICE_PORT: "0" });
    const { fail, messages } = collectingFail();
    expect(() => loadServerConfig(env, fail)).toThrow();
    expect(messages[0]).toMatch(/LLM_SERVICE_PORT/);
  });

  test("fails on negative port", () => {
    const env = envFrom({ LLM_SERVICE_PORT: "-1" });
    const { fail, messages } = collectingFail();
    expect(() => loadServerConfig(env, fail)).toThrow();
    expect(messages[0]).toMatch(/LLM_SERVICE_PORT/);
  });

  test("fails on port above 65535", () => {
    const env = envFrom({ LLM_SERVICE_PORT: "70000" });
    const { fail, messages } = collectingFail();
    expect(() => loadServerConfig(env, fail)).toThrow();
    expect(messages[0]).toMatch(/LLM_SERVICE_PORT/);
  });

  test("fails on non-positive timeout", () => {
    const env = envFrom({ LLM_SERVICE_TIMEOUT_MS: "0" });
    const { fail, messages } = collectingFail();
    expect(() => loadServerConfig(env, fail)).toThrow();
    expect(messages[0]).toMatch(/LLM_SERVICE_TIMEOUT_MS/);
  });

  test("whitespace-only host falls back to default", () => {
    const env = envFrom({ LLM_SERVICE_HOST: "   " });
    const { fail } = collectingFail();
    const cfg = loadServerConfig(env, fail);
    expect(cfg.host).toBe("0.0.0.0");
  });

  test("allowedModels parsed from CSV with trimming", () => {
    const env = envFrom({ LLM_SERVICE_ALLOWED_MODELS: " a:1 , b:2 ,c:3" });
    const { fail } = collectingFail();
    const cfg = loadServerConfig(env, fail);
    expect(cfg.allowedModels).toEqual(["a:1", "b:2", "c:3"]);
  });

  test("allowedModels ignores empty tokens and dedupes", () => {
    const env = envFrom({ LLM_SERVICE_ALLOWED_MODELS: "a,,b,a" });
    const { fail } = collectingFail();
    const cfg = loadServerConfig(env, fail);
    expect(cfg.allowedModels).toEqual(["a", "b"]);
  });

  test("fails on empty allowedModels list", () => {
    const env = envFrom({ LLM_SERVICE_ALLOWED_MODELS: " , , " });
    const { fail, messages } = collectingFail();
    expect(() => loadServerConfig(env, fail)).toThrow();
    expect(messages[0]).toMatch(/LLM_SERVICE_ALLOWED_MODELS/);
  });

  test("apiKeys: parses multi-key CSV", () => {
    const env = envFrom({ LLM_SERVICE_API_KEYS: "personal:sk-xxx,wife:sk-yyy" });
    const { fail } = collectingFail();
    const cfg = loadServerConfig(env, fail);
    expect(cfg.apiKeys.size).toBe(2);
    expect(cfg.apiKeys.get("personal")).toBe("sk-xxx");
    expect(cfg.apiKeys.get("wife")).toBe("sk-yyy");
  });

  test("apiKeys: trims whitespace around tokens", () => {
    const env = envFrom({ LLM_SERVICE_API_KEYS: " a : sk-1 , b : sk-2 " });
    const { fail } = collectingFail();
    const cfg = loadServerConfig(env, fail);
    expect(cfg.apiKeys.get("a")).toBe("sk-1");
    expect(cfg.apiKeys.get("b")).toBe("sk-2");
  });

  test("apiKeys: secret may contain colons (only first colon splits)", () => {
    const env = envFrom({ LLM_SERVICE_API_KEYS: "alice:sk-pre:fix:tail" });
    const { fail } = collectingFail();
    const cfg = loadServerConfig(env, fail);
    expect(cfg.apiKeys.get("alice")).toBe("sk-pre:fix:tail");
  });

  test("apiKeys: ignores empty CSV tokens", () => {
    const env = envFrom({ LLM_SERVICE_API_KEYS: "a:sk-1,,b:sk-2," });
    const { fail } = collectingFail();
    const cfg = loadServerConfig(env, fail);
    expect(cfg.apiKeys.size).toBe(2);
  });

  test("fails when LLM_SERVICE_API_KEYS is missing", () => {
    const env = envWithoutRequired({});
    const { fail, messages } = collectingFail();
    expect(() => loadServerConfig(env, fail)).toThrow();
    expect(messages[0]).toMatch(/LLM_SERVICE_API_KEYS/);
  });

  test("fails when LLM_SERVICE_API_KEYS is empty/whitespace", () => {
    const env = envWithoutRequired({ LLM_SERVICE_API_KEYS: "   " });
    const { fail, messages } = collectingFail();
    expect(() => loadServerConfig(env, fail)).toThrow();
    expect(messages[0]).toMatch(/LLM_SERVICE_API_KEYS/);
  });

  test("fails on malformed key (no colon)", () => {
    const env = envWithoutRequired({ LLM_SERVICE_API_KEYS: "no-colon-here" });
    const { fail, messages } = collectingFail();
    expect(() => loadServerConfig(env, fail)).toThrow();
    expect(messages[0]).toMatch(/LLM_SERVICE_API_KEYS/);
  });

  test("fails on key with empty keyId", () => {
    const env = envWithoutRequired({ LLM_SERVICE_API_KEYS: ":sk-secret" });
    const { fail, messages } = collectingFail();
    expect(() => loadServerConfig(env, fail)).toThrow();
    expect(messages[0]).toMatch(/LLM_SERVICE_API_KEYS/);
  });

  test("fails on key with empty secret", () => {
    const env = envWithoutRequired({ LLM_SERVICE_API_KEYS: "alice:" });
    const { fail, messages } = collectingFail();
    expect(() => loadServerConfig(env, fail)).toThrow();
    expect(messages[0]).toMatch(/LLM_SERVICE_API_KEYS/);
  });

  test("fails on duplicate keyId", () => {
    const env = envWithoutRequired({ LLM_SERVICE_API_KEYS: "alice:sk-1,alice:sk-2" });
    const { fail, messages } = collectingFail();
    expect(() => loadServerConfig(env, fail)).toThrow();
    expect(messages[0]).toMatch(/LLM_SERVICE_API_KEYS/);
  });

  test("rateLimit defaults to 10 capacity / 1 rps", () => {
    const env = envFrom({});
    const { fail } = collectingFail();
    const cfg = loadServerConfig(env, fail);
    expect(cfg.rateLimitCapacity).toBe(10);
    expect(cfg.rateLimitRefillPerSec).toBe(1);
  });

  test("rateLimit overrides apply", () => {
    const env = envFrom({
      LLM_SERVICE_RATE_CAPACITY: "5",
      LLM_SERVICE_RATE_REFILL_PER_SEC: "0.5",
    });
    const { fail } = collectingFail();
    const cfg = loadServerConfig(env, fail);
    expect(cfg.rateLimitCapacity).toBe(5);
    expect(cfg.rateLimitRefillPerSec).toBe(0.5);
  });

  test("fails on non-positive rate capacity", () => {
    const env = envFrom({ LLM_SERVICE_RATE_CAPACITY: "0" });
    const { fail, messages } = collectingFail();
    expect(() => loadServerConfig(env, fail)).toThrow();
    expect(messages[0]).toMatch(/LLM_SERVICE_RATE_CAPACITY/);
  });

  test("fails on non-positive refill", () => {
    const env = envFrom({ LLM_SERVICE_RATE_REFILL_PER_SEC: "-0.1" });
    const { fail, messages } = collectingFail();
    expect(() => loadServerConfig(env, fail)).toThrow();
    expect(messages[0]).toMatch(/LLM_SERVICE_RATE_REFILL_PER_SEC/);
  });
});
