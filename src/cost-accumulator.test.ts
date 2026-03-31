import { describe, test, expect } from "bun:test";
import {
  createCostAccumulator,
  addUsage,
  resetAccumulator,
  formatMemoryCost,
  hasUsage,
} from "./cost-accumulator";
import type { Model } from "./db";

const testModel: Model = {
  id: "test/model",
  name: "Test Model",
  input_price: 0.10,
  output_price: 0.40,
  context_size: 100_000,
};

describe("CostAccumulator", () => {
  test("starts with zero tokens", () => {
    const acc = createCostAccumulator();
    expect(acc.inputTokens).toBe(0);
    expect(acc.outputTokens).toBe(0);
  });

  test("accumulates usage from multiple adds", () => {
    const acc = createCostAccumulator();
    addUsage(acc, 100, 20);
    addUsage(acc, 200, 30);
    expect(acc.inputTokens).toBe(300);
    expect(acc.outputTokens).toBe(50);
  });

  test("resets to zero", () => {
    const acc = createCostAccumulator();
    addUsage(acc, 100, 20);
    resetAccumulator(acc);
    expect(acc.inputTokens).toBe(0);
    expect(acc.outputTokens).toBe(0);
  });

  test("hasUsage returns false when empty", () => {
    const acc = createCostAccumulator();
    expect(hasUsage(acc)).toBe(false);
  });

  test("hasUsage returns true after add", () => {
    const acc = createCostAccumulator();
    addUsage(acc, 100, 0);
    expect(hasUsage(acc)).toBe(true);
  });

  test("formats cost with status", () => {
    const acc = createCostAccumulator();
    addUsage(acc, 1000, 100);
    const result = formatMemoryCost(acc, testModel, "Сохранено в рабочую память");
    // cost = (1000/1M)*0.10 + (100/1M)*0.40 = 0.0001 + 0.00004 = 0.00014
    expect(result).toContain("Сохранено в рабочую память");
    expect(result).toContain("$0.000140");
    expect(result).toContain("1000 in / 100 out");
  });

  test("formats different statuses", () => {
    const acc = createCostAccumulator();
    addUsage(acc, 500, 50);
    const r1 = formatMemoryCost(acc, testModel, "Фактов не обнаружено");
    expect(r1).toContain("Фактов не обнаружено");

    const r2 = formatMemoryCost(acc, testModel, "Факты отклонены");
    expect(r2).toContain("Факты отклонены");
  });
});
