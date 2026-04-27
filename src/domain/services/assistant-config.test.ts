import { describe, test, expect } from "bun:test";
import { loadAssistantConfig } from "./assistant-config";

const REQUIRED: Record<string, string> = {
  ASSISTANT_LLM_BASE_URL: "http://localhost:8080/v1",
  ASSISTANT_LLM_API_KEY: "sk-test",
  ASSISTANT_LLM_MODEL: "qwen2.5-coder:7b",
};

function envFrom(overrides: Record<string, string | undefined>) {
  const merged = { ...REQUIRED, ...overrides };
  return (name: string) => merged[name];
}

function envWithout(missing: string) {
  const map: Record<string, string> = { ...REQUIRED };
  delete map[missing];
  return (name: string) => map[name];
}

function failingFail(): (msg: string) => never {
  return (message: string): never => {
    throw new Error(message);
  };
}

describe("loadAssistantConfig", () => {
  test("returns config with defaults when only required env is set", () => {
    const cfg = loadAssistantConfig(envFrom({}), failingFail());
    expect(cfg.llmBaseUrl).toBe("http://localhost:8080/v1");
    expect(cfg.llmApiKey).toBe("sk-test");
    expect(cfg.llmModel).toBe("qwen2.5-coder:7b");
    expect(cfg.embeddingBaseUrl).toBe("http://localhost:11434");
    expect(cfg.embeddingModel).toBe("nomic-embed-text");
    expect(cfg.dbPath).toBe("data/project-docs.db");
    expect(cfg.topK).toBe(5);
    expect(cfg.toolLoopMax).toBe(5);
    expect(cfg.projectRoot).toBe(process.cwd());
  });

  test("overrides apply from env", () => {
    const cfg = loadAssistantConfig(
      envFrom({
        ASSISTANT_EMBEDDING_BASE_URL: "http://other:11434/",
        ASSISTANT_EMBEDDING_MODEL: "mxbai-embed-large",
        ASSISTANT_DB_PATH: "/tmp/assistant.db",
        ASSISTANT_TOP_K: "8",
        ASSISTANT_TOOL_LOOP_MAX: "3",
        ASSISTANT_PROJECT_ROOT: "/tmp/proj",
      }),
      failingFail(),
    );
    expect(cfg.embeddingBaseUrl).toBe("http://other:11434");
    expect(cfg.embeddingModel).toBe("mxbai-embed-large");
    expect(cfg.dbPath).toBe("/tmp/assistant.db");
    expect(cfg.topK).toBe(8);
    expect(cfg.toolLoopMax).toBe(3);
    expect(cfg.projectRoot).toBe("/tmp/proj");
  });

  test("trailing slash on llm base url is stripped", () => {
    const cfg = loadAssistantConfig(
      envFrom({ ASSISTANT_LLM_BASE_URL: "http://localhost:8080/v1/" }),
      failingFail(),
    );
    expect(cfg.llmBaseUrl).toBe("http://localhost:8080/v1");
  });

  test("fails on missing ASSISTANT_LLM_BASE_URL with helpful message", () => {
    expect(() => loadAssistantConfig(envWithout("ASSISTANT_LLM_BASE_URL"), failingFail())).toThrow(
      /ASSISTANT_LLM_BASE_URL/,
    );
  });

  test("fails on missing ASSISTANT_LLM_API_KEY", () => {
    expect(() => loadAssistantConfig(envWithout("ASSISTANT_LLM_API_KEY"), failingFail())).toThrow(
      /ASSISTANT_LLM_API_KEY/,
    );
  });

  test("fails on missing ASSISTANT_LLM_MODEL", () => {
    expect(() => loadAssistantConfig(envWithout("ASSISTANT_LLM_MODEL"), failingFail())).toThrow(
      /ASSISTANT_LLM_MODEL/,
    );
  });

  test("fails on non-numeric top_k", () => {
    expect(() =>
      loadAssistantConfig(envFrom({ ASSISTANT_TOP_K: "abc" }), failingFail()),
    ).toThrow(/ASSISTANT_TOP_K/);
  });

  test("fails on top_k out of range (0)", () => {
    expect(() => loadAssistantConfig(envFrom({ ASSISTANT_TOP_K: "0" }), failingFail())).toThrow(
      /ASSISTANT_TOP_K/,
    );
  });

  test("fails on top_k out of range (>20)", () => {
    expect(() => loadAssistantConfig(envFrom({ ASSISTANT_TOP_K: "21" }), failingFail())).toThrow(
      /ASSISTANT_TOP_K/,
    );
  });

  test("fails on tool_loop_max out of range", () => {
    expect(() =>
      loadAssistantConfig(envFrom({ ASSISTANT_TOOL_LOOP_MAX: "11" }), failingFail()),
    ).toThrow(/ASSISTANT_TOOL_LOOP_MAX/);
    expect(() =>
      loadAssistantConfig(envFrom({ ASSISTANT_TOOL_LOOP_MAX: "0" }), failingFail()),
    ).toThrow(/ASSISTANT_TOOL_LOOP_MAX/);
  });

  test("empty whitespace value treated as missing", () => {
    expect(() =>
      loadAssistantConfig(envFrom({ ASSISTANT_LLM_MODEL: "   " }), failingFail()),
    ).toThrow(/ASSISTANT_LLM_MODEL/);
  });
});
