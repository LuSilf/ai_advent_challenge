import { describe, test, expect } from "bun:test";
import { buildResponseRequest } from "./request";
import type { AppConfig } from "./config";

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    prompt: "test prompt",
    apiKey: "key",
    model: "test-model",
    baseUrl: "http://localhost",
    systemPrompt: "system",
    effectiveTimeoutMs: 30000,
    debug: false,
    useStreaming: true,
    historyDb: "./data/history.db",
    historyLimit: 50,
    titleModel: "test-model",
    tokenPriceInput: 0.05,
    tokenPriceOutput: 0.40,
    contextTailSize: 10,
    ...overrides
  };
}

describe("buildResponseRequest", () => {
  test("without history, input is string", () => {
    const req = buildResponseRequest(makeConfig());
    expect(req.input).toBe("test prompt");
    expect(req.model).toBe("test-model");
    expect(req.instructions).toBe("system");
  });

  test("with empty history, input is string", () => {
    const req = buildResponseRequest(makeConfig(), []);
    expect(req.input).toBe("test prompt");
  });

  test("with history, input is message array", () => {
    const history = [
      { role: "user" as const, content: "привет" },
      { role: "assistant" as const, content: "ответ" }
    ];
    const req = buildResponseRequest(makeConfig({ prompt: "новый вопрос" }), history);

    expect(Array.isArray(req.input)).toBe(true);
    const input = req.input as Array<{ role: string; content: string }>;
    expect(input).toHaveLength(3);
    expect(input[0]).toEqual({ role: "user", content: "привет" });
    expect(input[1]).toEqual({ role: "assistant", content: "ответ" });
    expect(input[2]).toEqual({ role: "user", content: "новый вопрос" });
  });

  test("reasoning options passed through", () => {
    const req = buildResponseRequest(
      makeConfig({ reasoningEffort: "high", reasoningSummary: "concise" })
    );
    expect(req.reasoning).toEqual({ effort: "high", summary: "concise" });
  });

  test("temperature and top_p passed through", () => {
    const req = buildResponseRequest(makeConfig({ temperature: 0.5, topP: 0.9 }));
    expect(req.temperature).toBe(0.5);
    expect(req.top_p).toBe(0.9);
  });

  test("max_output_tokens from maxCompletionTokens", () => {
    const req = buildResponseRequest(makeConfig({ maxCompletionTokens: 1024 }));
    expect(req.max_output_tokens).toBe(1024);
  });
});
