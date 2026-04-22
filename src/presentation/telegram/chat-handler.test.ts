import { describe, test, expect } from "bun:test";
import { TelegramChatHandler } from "./chat-handler";
import { ChatHistoryStore } from "./history";
import type { LLMClient, StreamEvent } from "../../domain/ports/llm-client";
import type { LLMRequest, LLMResponse } from "../../domain/models";

type Captured = LLMRequest;

function createMockLLM(responder: (req: LLMRequest) => string): { client: LLMClient; captured: Captured[] } {
  const captured: Captured[] = [];
  const client: LLMClient = {
    async send(request: LLMRequest): Promise<LLMResponse & { rawResponse?: unknown }> {
      captured.push(structuredClone(request));
      return {
        content: responder(request),
        inputTokens: 1,
        outputTokens: 1,
      };
    },
    async *stream(): AsyncIterable<StreamEvent> {
      yield { type: "done", response: { content: "", inputTokens: 0, outputTokens: 0 } };
    },
  };
  return { client, captured };
}

describe("TelegramChatHandler", () => {
  test("first message sends instructions + single user turn", async () => {
    const { client, captured } = createMockLLM(() => "hi");
    const handler = new TelegramChatHandler({
      llmClient: client,
      history: new ChatHistoryStore(),
      model: "llama3.2:3b",
      systemPrompt: "быть кратким",
      maxCompletionTokens: 128,
    });
    await handler.handleMessage(42, "first");
    expect(captured).toHaveLength(1);
    expect(captured[0].instructions).toBe("быть кратким");
    expect(captured[0].model).toBe("llama3.2:3b");
    expect(captured[0].params.maxCompletionTokens).toBe(128);
    expect(captured[0].messages.map((m) => ({ role: m.role, content: m.content }))).toEqual([
      { role: "user", content: "first" },
    ]);
  });

  test("second message carries conversation history", async () => {
    const { client, captured } = createMockLLM(() => "ok");
    const handler = new TelegramChatHandler({
      llmClient: client,
      history: new ChatHistoryStore(),
      model: "m",
    });
    await handler.handleMessage(1, "привет");
    await handler.handleMessage(1, "как дела");
    expect(captured[1].messages.map((m) => ({ role: m.role, content: m.content }))).toEqual([
      { role: "user", content: "привет" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "как дела" },
    ]);
  });

  test("histories from different chats do not mix", async () => {
    const { client, captured } = createMockLLM(() => "ok");
    const handler = new TelegramChatHandler({
      llmClient: client,
      history: new ChatHistoryStore(),
      model: "m",
    });
    await handler.handleMessage(1, "chat1-first");
    await handler.handleMessage(2, "chat2-first");
    expect(captured[0].messages.map((m) => m.content)).toEqual(["chat1-first"]);
    expect(captured[1].messages.map((m) => m.content)).toEqual(["chat2-first"]);
  });

  test("clearHistory empties the store for the target chat", async () => {
    const history = new ChatHistoryStore();
    const { client, captured } = createMockLLM(() => "ok");
    const handler = new TelegramChatHandler({
      llmClient: client,
      history,
      model: "m",
    });
    await handler.handleMessage(1, "hi");
    handler.clearHistory(1);
    await handler.handleMessage(1, "again");
    expect(captured[1].messages.map((m) => m.content)).toEqual(["again"]);
    expect(history.get(1).map((t) => t.content)).toEqual(["again", "ok"]);
  });

  test("empty assistant reply is not saved to history", async () => {
    const history = new ChatHistoryStore();
    const { client } = createMockLLM(() => "   ");
    const handler = new TelegramChatHandler({
      llmClient: client,
      history,
      model: "m",
    });
    const reply = await handler.handleMessage(1, "q");
    expect(reply).toBe("");
    expect(history.get(1).map((t) => ({ role: t.role, content: t.content }))).toEqual([
      { role: "user", content: "q" },
    ]);
  });

  test("LLM errors propagate to caller", async () => {
    const boom: LLMClient = {
      async send() {
        throw new Error("ollama down");
      },
      async *stream(): AsyncIterable<StreamEvent> {},
    };
    const handler = new TelegramChatHandler({
      llmClient: boom,
      history: new ChatHistoryStore(),
      model: "m",
    });
    await expect(handler.handleMessage(1, "q")).rejects.toThrow("ollama down");
  });
});
