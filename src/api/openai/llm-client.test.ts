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
  test("wraps bare user prompt with system instruction", () => {
    const request = makeRequest({ messages: [] });
    const result = buildOpenAIRequest(request, "новый вопрос");
    expect(result.model).toBe("test/model");
    const messages = result.messages;
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: "system", content: "system prompt" });
    expect(messages[1]).toEqual({ role: "user", content: "новый вопрос" });
  });

  test("skips system message when instructions empty", () => {
    const request = makeRequest({ instructions: "" });
    const result = buildOpenAIRequest(request, "тест");
    const messages = result.messages;
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ role: "user", content: "тест" });
  });

  test("includes conversation history before user prompt", () => {
    const history = [
      makeMessage("user", "prev q", 1),
      makeMessage("assistant", "prev a", 2),
    ];
    const request = makeRequest({ messages: history });
    const result = buildOpenAIRequest(request, "новый вопрос");
    const messages = result.messages;
    expect(messages).toHaveLength(4);
    expect(messages[0].role).toBe("system");
    expect(messages[1]).toEqual({ role: "user", content: "prev q" });
    expect(messages[2]).toEqual({ role: "assistant", content: "prev a" });
    expect(messages[3]).toEqual({ role: "user", content: "новый вопрос" });
  });

  test("does not duplicate last user message when it matches userPrompt", () => {
    const history = [makeMessage("user", "тот же вопрос", 1)];
    const request = makeRequest({ messages: history });
    const result = buildOpenAIRequest(request, "тот же вопрос");
    const messages = result.messages;
    expect(messages).toHaveLength(2);
    expect(messages[1]).toEqual({ role: "user", content: "тот же вопрос" });
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

  test("passes maxCompletionTokens as max_completion_tokens", () => {
    const request = makeRequest({ params: { maxCompletionTokens: 1000 } });
    const result = buildOpenAIRequest(request, "test");
    expect(result.max_completion_tokens).toBe(1000);
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

  test("converts tools to chat.completions function shape", () => {
    const request = makeRequest({
      tools: [
        {
          name: "git-analyzer__git_log",
          description: "Show recent commits",
          parameters: {
            type: "object",
            properties: { count: { type: "number" } },
          },
        },
      ],
    });

    const result = buildOpenAIRequest(request, "test");
    expect(result.tools).toBeDefined();
    expect(result.tools!.length).toBe(1);
    const tool = result.tools![0] as { type: string; function: { name: string; description: string; parameters: unknown } };
    expect(tool.type).toBe("function");
    expect(tool.function.name).toBe("git-analyzer__git_log");
    expect(tool.function.description).toBe("Show recent commits");
    expect(tool.function.parameters).toEqual({
      type: "object",
      properties: { count: { type: "number" } },
    });
  });

  test("does not set tools when array is empty", () => {
    const request = makeRequest({ tools: [] });
    const result = buildOpenAIRequest(request, "test");
    expect(result.tools).toBeUndefined();
  });

  test("does not set tools when not provided", () => {
    const request = makeRequest();
    const result = buildOpenAIRequest(request, "test");
    expect(result.tools).toBeUndefined();
  });

  test("sets response_format with json_schema when responseFormat is provided", () => {
    const request = makeRequest({
      responseFormat: {
        type: "json_schema",
        name: "test_schema",
        strict: true,
        schema: {
          type: "object",
          required: ["answer"],
          additionalProperties: false,
          properties: { answer: { type: "string" } },
        },
      },
    });
    const result = buildOpenAIRequest(request, "test");
    expect(result.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "test_schema",
        strict: true,
        schema: {
          type: "object",
          required: ["answer"],
          additionalProperties: false,
          properties: { answer: { type: "string" } },
        },
      },
    });
  });

  test("does not set response_format when responseFormat is not provided", () => {
    const request = makeRequest();
    const result = buildOpenAIRequest(request, "test");
    expect(result.response_format).toBeUndefined();
  });
});
