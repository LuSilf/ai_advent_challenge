import { describe, test, expect } from "bun:test";
import {
  parseReconciliationResponse,
  buildReconciliationInput,
  buildExtractionInput,
} from "./reconciliation";

describe("parseReconciliationResponse", () => {
  test("parses valid JSON", () => {
    const result = parseReconciliationResponse(
      '{"updated_memory": "# Факты\\n- arch: monorepo", "changes_summary": "Добавлена архитектура"}'
    );
    expect(result.updatedMemory).toBe("# Факты\n- arch: monorepo");
    expect(result.changesSummary).toBe("Добавлена архитектура");
  });

  test("parses JSON in code block", () => {
    const result = parseReconciliationResponse(
      '```json\n{"updated_memory": "data", "changes_summary": "added data"}\n```'
    );
    expect(result.updatedMemory).toBe("data");
    expect(result.changesSummary).toBe("added data");
  });

  test("handles empty changes (no updates needed)", () => {
    const result = parseReconciliationResponse(
      '{"updated_memory": "", "changes_summary": ""}'
    );
    expect(result.updatedMemory).toBe("");
    expect(result.changesSummary).toBe("");
  });

  test("handles missing fields gracefully", () => {
    const result = parseReconciliationResponse('{"updated_memory": "data"}');
    expect(result.updatedMemory).toBe("data");
    expect(result.changesSummary).toBe("");
  });

  test("handles non-string fields", () => {
    const result = parseReconciliationResponse(
      '{"updated_memory": 123, "changes_summary": null}'
    );
    expect(result.updatedMemory).toBe("");
    expect(result.changesSummary).toBe("");
  });

  test("throws on invalid JSON", () => {
    expect(() => parseReconciliationResponse("not json")).toThrow();
  });

  test("throws on array", () => {
    expect(() => parseReconciliationResponse("[1, 2]")).toThrow("Ожидался JSON объект");
  });
});

describe("buildReconciliationInput", () => {
  test("combines current memory and new content", () => {
    const input = buildReconciliationInput("existing facts", "new dialog");
    expect(input).toContain("Текущая память:\nexisting facts");
    expect(input).toContain("Новый контент:\nnew dialog");
  });
});

describe("buildExtractionInput", () => {
  test("wraps new content for extraction", () => {
    const input = buildExtractionInput("dialog content");
    expect(input).toContain("Контент для анализа:\ndialog content");
  });
});
