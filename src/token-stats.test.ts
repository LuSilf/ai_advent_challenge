import { describe, test, expect } from "bun:test";
import { calculateCost, formatTokenStats } from "./token-stats";

describe("calculateCost", () => {
  test("рассчитывает стоимость по дефолтным ценам", () => {
    const cost = calculateCost(
      { inputTokens: 1000, outputTokens: 500 },
      { inputPricePerMillion: 0.05, outputPricePerMillion: 0.40 }
    );
    // (1000 * 0.05 + 500 * 0.40) / 1_000_000 = (50 + 200) / 1_000_000 = 0.00025
    expect(cost).toBeCloseTo(0.00025, 10);
  });

  test("рассчитывает стоимость по пользовательским ценам", () => {
    const cost = calculateCost(
      { inputTokens: 2000, outputTokens: 1000 },
      { inputPricePerMillion: 3.0, outputPricePerMillion: 15.0 }
    );
    // (2000 * 3.0 + 1000 * 15.0) / 1_000_000 = (6000 + 15000) / 1_000_000 = 0.021
    expect(cost).toBeCloseTo(0.021, 10);
  });

  test("возвращает 0 при нулевых токенах", () => {
    const cost = calculateCost(
      { inputTokens: 0, outputTokens: 0 },
      { inputPricePerMillion: 0.05, outputPricePerMillion: 0.40 }
    );
    expect(cost).toBe(0);
  });
});

describe("formatTokenStats", () => {
  test("форматирует строку с токенами и стоимостью", () => {
    const result = formatTokenStats(
      { inputTokens: 1234, outputTokens: 567 },
      { inputPricePerMillion: 0.05, outputPricePerMillion: 0.40 }
    );
    expect(result).toContain("1234 in");
    expect(result).toContain("567 out");
    expect(result).toContain("$");
  });

  test("стоимость отображается с 4 знаками после запятой", () => {
    const result = formatTokenStats(
      { inputTokens: 100, outputTokens: 100 },
      { inputPricePerMillion: 0.05, outputPricePerMillion: 0.40 }
    );
    // cost = (100*0.05 + 100*0.40) / 1M = 0.000045 → "$0.0000"
    expect(result).toContain("$0.0000");
  });
});
