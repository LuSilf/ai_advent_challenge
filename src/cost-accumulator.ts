import { calculateCost, formatCost, type Model } from "./db";

export type MemoryCostAccumulator = {
  inputTokens: number;
  outputTokens: number;
};

export function createCostAccumulator(): MemoryCostAccumulator {
  return { inputTokens: 0, outputTokens: 0 };
}

export function addUsage(acc: MemoryCostAccumulator, inputTokens: number, outputTokens: number): void {
  acc.inputTokens += inputTokens;
  acc.outputTokens += outputTokens;
}

export function resetAccumulator(acc: MemoryCostAccumulator): void {
  acc.inputTokens = 0;
  acc.outputTokens = 0;
}

export function formatMemoryCost(acc: MemoryCostAccumulator, model: Model, status: string): string {
  const info = calculateCost(model, acc.inputTokens, acc.outputTokens);
  const costStr = info.cost < 0.01
    ? `$${info.cost.toFixed(6)}`
    : `$${info.cost.toFixed(4)}`;
  return `💡 ${status}: ${costStr} (${acc.inputTokens} in / ${acc.outputTokens} out)`;
}

export function hasUsage(acc: MemoryCostAccumulator): boolean {
  return acc.inputTokens > 0 || acc.outputTokens > 0;
}
