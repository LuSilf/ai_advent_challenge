import pc from "picocolors";

export type TokenPricing = {
  inputPricePerMillion: number;
  outputPricePerMillion: number;
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

export function calculateCost(usage: TokenUsage, pricing: TokenPricing): number {
  return (
    (usage.inputTokens * pricing.inputPricePerMillion +
      usage.outputTokens * pricing.outputPricePerMillion) /
    1_000_000
  );
}

export function formatTokenStats(usage: TokenUsage, pricing: TokenPricing): string {
  const cost = calculateCost(usage, pricing);
  return pc.dim(
    `📊 Tokens: ${usage.inputTokens} in / ${usage.outputTokens} out | Cost: $${cost.toFixed(4)}`
  );
}
