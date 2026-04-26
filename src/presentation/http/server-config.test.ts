import { describe, test, expect } from "bun:test";
import { loadServerConfig } from "./server-config";

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

describe("loadServerConfig (phase 1)", () => {
  test("returns defaults when only mandatory env is set", () => {
    const env = envFrom({});
    const { fail } = collectingFail();
    const cfg = loadServerConfig(env, fail);
    expect(cfg.host).toBe("0.0.0.0");
    expect(cfg.port).toBe(8080);
    expect(cfg.ollamaBaseUrl).toBe("http://localhost:11434");
    expect(cfg.requestTimeoutMs).toBe(180_000);
    expect(cfg.allowedModels).toEqual(["llama3.2:3b", "qwen2.5-coder:7b"]);
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
});
