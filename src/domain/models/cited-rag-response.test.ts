import { describe, test, expect } from "bun:test";
import {
  CitedRagResponseSchema,
  citedRagResponseToOpenAISchema,
  parseCitedRagResponse,
} from "./cited-rag-response";

describe("CitedRagResponseSchema", () => {
  const validResponse = {
    answer: "Кэширование ускоряет чтение данных",
    confidence: "high" as const,
    sources: [
      { sourceIndex: 1, source: "primer.md", section: "Cache > Overview" },
    ],
    quotes: [
      { sourceIndex: 1, text: "Caching improves page load times" },
    ],
  };

  test("accepts valid response", () => {
    const result = CitedRagResponseSchema.safeParse(validResponse);
    expect(result.success).toBe(true);
  });

  test("accepts response with null section", () => {
    const response = {
      ...validResponse,
      sources: [{ sourceIndex: 1, source: "primer.md", section: null }],
    };
    const result = CitedRagResponseSchema.safeParse(response);
    expect(result.success).toBe(true);
  });

  test("accepts empty sources and quotes", () => {
    const response = {
      ...validResponse,
      confidence: "insufficient" as const,
      sources: [],
      quotes: [],
    };
    const result = CitedRagResponseSchema.safeParse(response);
    expect(result.success).toBe(true);
  });

  test("rejects missing answer", () => {
    const { answer, ...rest } = validResponse;
    const result = CitedRagResponseSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  test("rejects invalid confidence value", () => {
    const response = { ...validResponse, confidence: "maybe" };
    const result = CitedRagResponseSchema.safeParse(response);
    expect(result.success).toBe(false);
  });

  test("rejects missing sources", () => {
    const { sources, ...rest } = validResponse;
    const result = CitedRagResponseSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  test("rejects source with missing sourceIndex", () => {
    const response = {
      ...validResponse,
      sources: [{ source: "primer.md", section: "Cache" }],
    };
    const result = CitedRagResponseSchema.safeParse(response);
    expect(result.success).toBe(false);
  });
});

describe("citedRagResponseToOpenAISchema", () => {
  test("returns json_schema format with correct name", () => {
    const schema = citedRagResponseToOpenAISchema();
    expect(schema.type).toBe("json_schema");
    expect(schema.name).toBe("cited_rag_response");
    expect(schema.strict).toBe(true);
  });

  test("schema has all required fields", () => {
    const schema = citedRagResponseToOpenAISchema();
    const inner = schema.schema as Record<string, unknown>;
    expect(inner.required).toEqual(["answer", "confidence", "sources", "quotes"]);
    expect(inner.additionalProperties).toBe(false);
  });

  test("confidence is enum with three values", () => {
    const schema = citedRagResponseToOpenAISchema();
    const props = (schema.schema as any).properties;
    expect(props.confidence.enum).toEqual(["high", "low", "insufficient"]);
  });
});

describe("parseCitedRagResponse", () => {
  test("parses valid JSON string", () => {
    const json = JSON.stringify({
      answer: "test",
      confidence: "high",
      sources: [{ sourceIndex: 1, source: "a.md", section: null }],
      quotes: [{ sourceIndex: 1, text: "quote" }],
    });
    const result = parseCitedRagResponse(json);
    expect(result).not.toBeNull();
    expect(result!.answer).toBe("test");
    expect(result!.confidence).toBe("high");
  });

  test("returns null for invalid JSON", () => {
    expect(parseCitedRagResponse("not json")).toBeNull();
  });

  test("returns null for valid JSON with wrong schema", () => {
    expect(parseCitedRagResponse('{"foo":"bar"}')).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(parseCitedRagResponse("")).toBeNull();
  });
});
