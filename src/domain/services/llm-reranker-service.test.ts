import { describe, test, expect } from "bun:test";
import { parseRelevanceScore, LlmRerankerService } from "./llm-reranker-service";
import type { VectorSearchHit } from "../models/chunking";

function makeHit(id: number, distance: number): VectorSearchHit {
  return {
    id,
    strategy: "structural",
    source: "test.md",
    title: null,
    section: `section-${id}`,
    chunkIndex: 0,
    charStart: 0,
    charEnd: 100,
    text: `chunk text ${id}`,
    distance,
  };
}

describe("parseRelevanceScore", () => {
  test("parses simple float", () => {
    expect(parseRelevanceScore("0.75")).toBeCloseTo(0.75, 2);
  });

  test("parses integer 1", () => {
    expect(parseRelevanceScore("1")).toBeCloseTo(1.0, 2);
  });

  test("parses zero", () => {
    expect(parseRelevanceScore("0")).toBeCloseTo(0.0, 2);
  });

  test("clamps value above 1.0", () => {
    expect(parseRelevanceScore("1.5")).toBeCloseTo(1.0, 2);
  });

  test("clamps negative value to 0", () => {
    expect(parseRelevanceScore("-0.5")).toBeCloseTo(0.0, 2);
  });

  test("handles text around number", () => {
    expect(parseRelevanceScore("Score: 0.8")).toBeCloseTo(0.8, 2);
  });

  test("returns 0 for garbage", () => {
    expect(parseRelevanceScore("not a number")).toBe(0);
  });

  test("returns 0 for empty string", () => {
    expect(parseRelevanceScore("")).toBe(0);
  });

  test("handles whitespace", () => {
    expect(parseRelevanceScore("  0.65  \n")).toBeCloseTo(0.65, 2);
  });
});

describe("LlmRerankerService", () => {
  test("filters out hits below minRelevance and sorts by relevance", async () => {
    const hits = [makeHit(1, 0.5), makeHit(2, 0.6), makeHit(3, 0.7)];

    let callIndex = 0;
    const scores = [0.9, 0.1, 0.6];

    const mockFetch = async (_url: string | URL | Request, init?: RequestInit) => {
      const score = scores[callIndex++] ?? 0;
      return new Response(
        JSON.stringify({ message: { content: String(score) } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as typeof fetch;

    try {
      const reranker = new LlmRerankerService(
        { baseUrl: "http://localhost:11434", model: "test" },
        0.3,
      );
      const result = await reranker.rerank("test query", hits);

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe(1);
      expect(result[0]!.relevanceScore).toBeCloseTo(0.9, 2);
      expect(result[1]!.id).toBe(3);
      expect(result[1]!.relevanceScore).toBeCloseTo(0.6, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("returns 0 score when fetch fails", async () => {
    const hits = [makeHit(1, 0.5)];

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("network error");
    };

    try {
      const reranker = new LlmRerankerService(
        { baseUrl: "http://localhost:11434", model: "test" },
        0.3,
      );
      const result = await reranker.rerank("test query", hits);

      expect(result).toHaveLength(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
