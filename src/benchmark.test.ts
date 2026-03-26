import { describe, test, expect } from "bun:test";
import { formatBenchmarkTable } from "./benchmark";

describe("formatBenchmarkTable", () => {
  test("форматирует таблицу с двумя колонками", () => {
    const compressed = {
      text: "Сжатый ответ",
      inputTokens: 234,
      outputTokens: 567,
      cost: 0.0012,
      messageCount: 10
    };
    const full = {
      text: "Полный ответ",
      inputTokens: 1234,
      outputTokens: 567,
      cost: 0.0029,
      messageCount: 50
    };

    const table = formatBenchmarkTable(compressed, full, "+ summary");

    expect(table).toContain("Со сжатием");
    expect(table).toContain("Без сжатия");
    expect(table).toContain("Сжатый ответ");
    expect(table).toContain("Полный ответ");
    expect(table).toContain("234 in");
    expect(table).toContain("1234 in");
    expect(table).toContain("$0.0012");
    expect(table).toContain("$0.0029");
    expect(table).toContain("10 + summary");
    expect(table).toContain("50");
  });

  test("работает без summary label", () => {
    const result = {
      text: "ответ",
      inputTokens: 100,
      outputTokens: 50,
      cost: 0.001,
      messageCount: 5
    };

    const table = formatBenchmarkTable(result, result, "");
    expect(table).toContain("Со сжатием");
    expect(table).toContain("Без сжатия");
  });
});
