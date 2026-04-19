import { describe, test, expect } from "bun:test";
import { scoreCitation } from "./citation-scorer";
import type { CitedRagResponse } from "../models/cited-rag-response";

function makeResponse(overrides: Partial<CitedRagResponse> = {}): CitedRagResponse {
  return {
    answer: "Test answer",
    confidence: "high",
    sources: [{ sourceIndex: 1, source: "doc.md", section: "Sec A" }],
    quotes: [{ sourceIndex: 1, text: "Quote text" }],
    ...overrides,
  };
}

describe("scoreCitation", () => {
  test("scores response with sources and quotes", () => {
    const result = scoreCitation(makeResponse(), false);
    expect(result.hasSources).toBe(true);
    expect(result.hasQuotes).toBe(true);
    expect(result.sourceCount).toBe(1);
    expect(result.quoteCount).toBe(1);
    expect(result.confidence).toBe("high");
    expect(result.isInsufficientCorrect).toBeUndefined();
  });

  test("scores response without sources", () => {
    const result = scoreCitation(makeResponse({ sources: [] }), false);
    expect(result.hasSources).toBe(false);
    expect(result.sourceCount).toBe(0);
  });

  test("scores response without quotes", () => {
    const result = scoreCitation(makeResponse({ quotes: [] }), false);
    expect(result.hasQuotes).toBe(false);
    expect(result.quoteCount).toBe(0);
  });

  test("marks insufficient as correct for out-of-scope question", () => {
    const result = scoreCitation(makeResponse({ confidence: "insufficient", sources: [], quotes: [] }), true);
    expect(result.isInsufficientCorrect).toBe(true);
  });

  test("marks non-insufficient as incorrect for out-of-scope question", () => {
    const result = scoreCitation(makeResponse({ confidence: "high" }), true);
    expect(result.isInsufficientCorrect).toBe(false);
  });

  test("handles null response", () => {
    const result = scoreCitation(null, false);
    expect(result.hasSources).toBe(false);
    expect(result.hasQuotes).toBe(false);
    expect(result.confidence).toBe("insufficient");
  });
});
