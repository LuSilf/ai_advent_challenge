import { describe, test, expect } from "bun:test";

import { RagJudgeService, buildJudgeInput, parseJudgeResponse } from "./rag-judge-service";
import type { LLMClient } from "../ports/llm-client";
import type { LLMRequest, LLMResponse, Model } from "../models";
import type { ModelRepository } from "../ports/model-repository";

class FakeLLMClient implements LLMClient {
  public lastRequest: LLMRequest | null = null;

  async send(request: LLMRequest): Promise<LLMResponse & { rawResponse?: unknown }> {
    this.lastRequest = request;
    return {
      content: '{"score": 3, "verdict": "Полный и корректный ответ"}',
      inputTokens: 10,
      outputTokens: 5,
    };
  }

  async *stream() {
    throw new Error("not implemented");
  }
}

class FakeModelRepo implements ModelRepository {
  getAll(): Model[] { return []; }
  getById(_id: string): Model | null { return null; }
  getRole(role: string): Model | null {
    if (role === "judge") return { id: "openai/gpt-5-nano", name: "Judge", inputPrice: 0, outputPrice: 0, contextSize: 1 };
    if (role === "chat") return { id: "openai/gpt-5-nano", name: "Chat", inputPrice: 0, outputPrice: 0, contextSize: 1 };
    return null;
  }
  getRoles() { return []; }
  setRole(): void {}
}

describe("RagJudgeService", () => {
  test("uses judge model and parses JSON response", async () => {
    const llmClient = new FakeLLMClient();
    const service = new RagJudgeService(llmClient, new FakeModelRepo());

    const result = await service.judge(
      {
        id: "q1",
        question: "What is cache-aside?",
        expectation: "Explain cache-aside.",
        expectedSections: ["Cache > When to update the cache"],
      },
      "Cache-aside lazily loads data.",
    );

    expect(result.score).toBe(3);
    expect(result.verdict).toBe("Полный и корректный ответ");
    expect(result.modelId).toBe("openai/gpt-5-nano");
    expect(llmClient.lastRequest?.instructions).toContain("строгий оценщик");
    expect(llmClient.lastRequest?.messages[0]?.content).toContain("What is cache-aside?");
  });
});

describe("buildJudgeInput", () => {
  test("includes expectation and retrieval summary", () => {
    const input = buildJudgeInput(
      {
        id: "q1",
        question: "What is cache-aside?",
        expectation: "Explain cache-aside.",
        expectedSections: ["Cache > When to update the cache"],
      },
      "Cache-aside lazily loads data.",
      {
        status: "ok",
        strategy: "structural",
        topK: 5,
        promptSuffix: "ctx",
        hits: [
          {
            id: 1,
            strategy: "structural",
            source: "primer.md",
            title: "Primer",
            section: "Cache > When to update the cache",
            chunkIndex: 0,
            charStart: 0,
            charEnd: 100,
            text: "...",
            distance: 0.1234,
          },
        ],
      },
    );

    expect(input).toContain("Ожидание: Explain cache-aside.");
    expect(input).toContain("Ожидаемые секции: Cache > When to update the cache");
    expect(input).toContain("primer.md :: Cache > When to update the cache :: 0.1234");
  });
});

describe("parseJudgeResponse", () => {
  test("parses plain json", () => {
    expect(parseJudgeResponse('{"score": 2, "verdict": "Неплохо"}')).toEqual({
      score: 2,
      verdict: "Неплохо",
    });
  });

  test("parses json inside code block", () => {
    expect(parseJudgeResponse('```json\n{"score": 1, "verdict": "Частично"}\n```')).toEqual({
      score: 1,
      verdict: "Частично",
    });
  });
});
