import { describe, test, expect } from "bun:test";
import { formatCost, formatCompactTokenLine, formatTokenTable } from "./token-display";
import type { TokenUsageRow } from "./db";

describe("formatCost", () => {
  test("zero cost", () => {
    expect(formatCost(0)).toBe("$0");
  });

  test("normal cost", () => {
    expect(formatCost(0.0031)).toBe("$0.0031");
  });

  test("very small cost uses exponential", () => {
    const result = formatCost(0.00001);
    expect(result).toMatch(/\$\d\.\d+e/);
  });

  test("rounds to 4 decimals", () => {
    expect(formatCost(0.00156789)).toBe("$0.0016");
  });
});

describe("formatCompactTokenLine", () => {
  test("formats compact line with percentages", () => {
    const line = formatCompactTokenLine(450, 120, 2340, 400_000, 0.003);
    // Убираем ANSI-коды для проверки содержимого
    const plain = line.replace(/\x1b\[[0-9;]*m/g, "");
    expect(plain).toContain("in:450");
    expect(plain).toContain("out:120");
    expect(plain).toContain("сессия: 2340/400k");
    expect(plain).toContain("0.6%");
    expect(plain).toContain("$0.0030");
  });

  test("formats context in k", () => {
    const line = formatCompactTokenLine(100, 50, 500, 128_000, 0);
    const plain = line.replace(/\x1b\[[0-9;]*m/g, "");
    expect(plain).toContain("128k");
  });

  test("small context stays as number", () => {
    const line = formatCompactTokenLine(10, 5, 15, 500, 0);
    const plain = line.replace(/\x1b\[[0-9;]*m/g, "");
    expect(plain).toContain("15/500");
  });
});

describe("formatTokenTable", () => {
  const makeRow = (num: number, input: number, output: number): TokenUsageRow => ({
    id: num,
    session_id: 1,
    exchangeNum: num,
    inputTokens: input,
    outputTokens: output,
    cachedTokens: 0,
    reasoningTokens: 0,
    totalTokens: input + output,
    inputCost: input * 0.000001,
    outputCost: output * 0.000002,
    totalCost: input * 0.000001 + output * 0.000002,
    created_at: "2025-01-01",
  });

  test("renders table with rows and totals", () => {
    const rows = [makeRow(1, 120, 85), makeRow(2, 340, 102)];
    const table = formatTokenTable(rows, 3, 400_000);
    const plain = table.replace(/\x1b\[[0-9;]*m/g, "");

    expect(plain).toContain("Статистика сессии #3 (2 обменов)");
    expect(plain).toContain("120");
    expect(plain).toContain("85");
    expect(plain).toContain("340");
    expect(plain).toContain("102");
    expect(plain).toContain("Всего:");
    expect(plain).toContain("Контекст:");
    expect(plain).toContain("400000");
  });
});
