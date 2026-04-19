import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildResponseRequest } from "./request";
import type { AppConfig } from "./config";
import { getLongTermMemoryPath, getWorkingMemoryPath } from "./memory";

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    prompt: "test prompt",
    apiKey: "key",
    baseUrl: "http://localhost",
    systemPrompt: "system",
    effectiveTimeoutMs: 30000,
    debug: false,
    useStreaming: true,
    historyDb: "./data/history.db",
    historyLimit: 50,
    contextStrategy: "full",
    day25Mode: false,
    ...overrides
  };
}

let tmpDir: string;
let savedMemoryDir: string | undefined;
let savedCwd: string;

describe("buildResponseRequest", () => {
  beforeEach(() => {
    tmpDir = join(tmpdir(), `req-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    savedMemoryDir = process.env.MEMORY_DIR;
    savedCwd = process.cwd();
    // Изолируем от реальных файлов памяти
    process.env.MEMORY_DIR = join(tmpDir, "nomemory");
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(savedCwd);
    if (savedMemoryDir === undefined) {
      delete process.env.MEMORY_DIR;
    } else {
      process.env.MEMORY_DIR = savedMemoryDir;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("without history, input is string", () => {
    const req = buildResponseRequest(makeConfig(), "test-model");
    expect(req.input).toBe("test prompt");
    expect(req.model).toBe("test-model");
    expect(req.instructions).toBe("system");
  });

  test("with empty history, input is string", () => {
    const req = buildResponseRequest(makeConfig(), "test-model", []);
    expect(req.input).toBe("test prompt");
  });

  test("with history, input is message array", () => {
    const history = [
      { role: "user" as const, content: "привет" },
      { role: "assistant" as const, content: "ответ" }
    ];
    const req = buildResponseRequest(makeConfig({ prompt: "новый вопрос" }), "test-model", history);

    expect(Array.isArray(req.input)).toBe(true);
    const input = req.input as Array<{ role: string; content: string }>;
    expect(input).toHaveLength(3);
    expect(input[0]).toEqual({ role: "user", content: "привет" });
    expect(input[1]).toEqual({ role: "assistant", content: "ответ" });
    expect(input[2]).toEqual({ role: "user", content: "новый вопрос" });
  });

  test("reasoning options passed through", () => {
    const req = buildResponseRequest(
      makeConfig({ reasoningEffort: "high", reasoningSummary: "concise" }),
      "test-model"
    );
    expect(req.reasoning).toEqual({ effort: "high", summary: "concise" });
  });

  test("temperature and top_p passed through", () => {
    const req = buildResponseRequest(makeConfig({ temperature: 0.5, topP: 0.9 }), "test-model");
    expect(req.temperature).toBe(0.5);
    expect(req.top_p).toBe(0.9);
  });

  test("max_output_tokens from maxCompletionTokens", () => {
    const req = buildResponseRequest(makeConfig({ maxCompletionTokens: 1024 }), "test-model");
    expect(req.max_output_tokens).toBe(1024);
  });

  test("factsBlock prepended to instructions", () => {
    const factsBlock = "Известные факты:\n- цель: тестирование";
    const req = buildResponseRequest(makeConfig({ systemPrompt: "system prompt" }), "test-model", [], factsBlock);
    expect(req.instructions).toBe("Известные факты:\n- цель: тестирование\n\nsystem prompt");
  });

  test("without factsBlock instructions unchanged", () => {
    const req = buildResponseRequest(makeConfig({ systemPrompt: "system prompt" }), "test-model");
    expect(req.instructions).toBe("system prompt");
  });

  test("memory blocks prepended to instructions", () => {
    // Создаём файлы памяти в tmpDir
    const memDir = join(tmpDir, "nomemory");
    mkdirSync(memDir, { recursive: true });
    writeFileSync(join(memDir, "memory.md"), "global rule");
    mkdirSync(join(tmpDir, ".ai"), { recursive: true });
    writeFileSync(join(tmpDir, ".ai/memory.md"), "project fact");

    const req = buildResponseRequest(makeConfig({ systemPrompt: "sys" }), "test-model");
    expect(req.instructions).toBe(
      "[Долговременная память]\nglobal rule\n\n[Рабочая память проекта]\nproject fact\n\nsys"
    );
  });

  test("memory blocks + factsBlock both prepended, facts first", () => {
    const memDir = join(tmpDir, "nomemory");
    mkdirSync(memDir, { recursive: true });
    writeFileSync(join(memDir, "memory.md"), "global");

    const req = buildResponseRequest(makeConfig({ systemPrompt: "sys" }), "test-model", [], "facts here");
    expect(req.instructions).toBe(
      "facts here\n\n[Долговременная память]\nglobal\n\nsys"
    );
  });
});
