import { describe, test, expect } from "bun:test";
import { buildOpenAIRequest } from "./llm-client";
import type { LLMRequest, Message } from "../../domain/models";

function makeRequest(overrides: Partial<LLMRequest> = {}): LLMRequest {
  return {
    messages: [],
    instructions: "system prompt",
    model: "test/model",
    params: {},
    ...overrides,
  };
}

function makeMessage(role: "user" | "assistant", content: string, id = 1): Message {
  return { id, sessionId: 1, role, content, createdAt: new Date().toISOString() };
}

describe("buildOpenAIRequest", () => {
  test("converts empty messages to simple input", () => {
    const request = makeRequest({ messages: [] });
    const result = buildOpenAIRequest(request, "новый вопрос");
    expect(result.model).toBe("test/model");
    expect(result.instructions).toBe("system prompt");
    expect(result.input).toBe("новый вопрос");
  });

  test("converts messages to OpenAI format with user prompt appended", () => {
    const messages = [
      makeMessage("user", "prev q", 1),
      makeMessage("assistant", "prev a", 2),
    ];
    const request = makeRequest({ messages });
    const result = buildOpenAIRequest(request, "новый вопрос");
    expect(Array.isArray(result.input)).toBe(true);
    const input = result.input as Array<{ role: string; content: string }>;
    expect(input).toHaveLength(3);
    expect(input[0].role).toBe("user");
    expect(input[0].content).toBe("prev q");
    expect(input[2].role).toBe("user");
    expect(input[2].content).toBe("новый вопрос");
  });

  test("passes temperature from params", () => {
    const request = makeRequest({ params: { temperature: 0.7 } });
    const result = buildOpenAIRequest(request, "test");
    expect(result.temperature).toBe(0.7);
  });

  test("passes topP from params", () => {
    const request = makeRequest({ params: { topP: 0.9 } });
    const result = buildOpenAIRequest(request, "test");
    expect(result.top_p).toBe(0.9);
  });

  test("passes maxCompletionTokens from params", () => {
    const request = makeRequest({ params: { maxCompletionTokens: 1000 } });
    const result = buildOpenAIRequest(request, "test");
    expect(result.max_output_tokens).toBe(1000);
  });

  test("passes reasoning from params", () => {
    const request = makeRequest({ params: { reasoningEffort: "high", reasoningSummary: "auto" } });
    const result = buildOpenAIRequest(request, "test");
    expect(result.reasoning).toEqual({ effort: "high", summary: "auto" });
  });

  test("stream defaults to false", () => {
    const request = makeRequest();
    const result = buildOpenAIRequest(request, "test");
    expect(result.stream).toBe(false);
  });

  test("passes stream from params", () => {
    const request = makeRequest({ params: { stream: true } });
    const result = buildOpenAIRequest(request, "test");
    expect(result.stream).toBe(true);
  });
});
