import { describe, test, expect } from "bun:test";
import { formatCitedRagResponse } from "./cited-response-formatter";
import type { CitedRagResponse } from "../../domain/models/cited-rag-response";

function makeResponse(overrides: Partial<CitedRagResponse> = {}): CitedRagResponse {
  return {
    answer: "Кэширование ускоряет доступ к данным",
    confidence: "high",
    sources: [
      { sourceIndex: 1, source: "primer.md", section: "Cache > Overview" },
    ],
    quotes: [
      { sourceIndex: 1, text: "Caching improves page load times" },
    ],
    ...overrides,
  };
}

describe("formatCitedRagResponse", () => {
  test("includes answer, sources, and quotes for high confidence", () => {
    const output = formatCitedRagResponse(makeResponse());
    expect(output).toContain("Кэширование ускоряет доступ к данным");
    expect(output).toContain("Источники:");
    expect(output).toContain("primer.md > Cache > Overview");
    expect(output).toContain("Цитаты:");
    expect(output).toContain("Caching improves page load times");
  });

  test("shows warning for low confidence", () => {
    const output = formatCitedRagResponse(makeResponse({ confidence: "low" }));
    expect(output).toContain("частично подкреплён");
  });

  test("shows insufficient context message without sources/quotes", () => {
    const output = formatCitedRagResponse(makeResponse({
      confidence: "insufficient",
      answer: "К сожалению, в базе знаний нет информации для ответа.",
      sources: [],
      quotes: [],
    }));
    expect(output).toContain("Недостаточно контекста");
    expect(output).toContain("К сожалению");
    expect(output).not.toContain("Источники:");
    expect(output).not.toContain("Цитаты:");
  });

  test("handles empty sources gracefully", () => {
    const output = formatCitedRagResponse(makeResponse({ sources: [] }));
    expect(output).not.toContain("Источники:");
    expect(output).toContain("Цитаты:");
  });

  test("handles empty quotes gracefully", () => {
    const output = formatCitedRagResponse(makeResponse({ quotes: [] }));
    expect(output).toContain("Источники:");
    expect(output).not.toContain("Цитаты:");
  });

  test("handles null section", () => {
    const output = formatCitedRagResponse(makeResponse({
      sources: [{ sourceIndex: 1, source: "doc.md", section: null }],
    }));
    expect(output).toContain("1. doc.md");
    expect(output).not.toContain("> null");
  });

  test("formats multiple sources and quotes", () => {
    const output = formatCitedRagResponse(makeResponse({
      sources: [
        { sourceIndex: 1, source: "a.md", section: "Sec A" },
        { sourceIndex: 2, source: "b.md", section: "Sec B" },
      ],
      quotes: [
        { sourceIndex: 1, text: "Quote one" },
        { sourceIndex: 2, text: "Quote two" },
      ],
    }));
    expect(output).toContain("1. a.md > Sec A");
    expect(output).toContain("2. b.md > Sec B");
    expect(output).toContain("[1]");
    expect(output).toContain("[2]");
  });
});
