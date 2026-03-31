import type { CostInfo, Model } from "../models";
import type { ModelRepository } from "../ports/model-repository";

export class CostService {
  private total: CostInfo = { cost: 0, inputTokens: 0, outputTokens: 0 };

  constructor(private readonly modelRepo: ModelRepository) {}

  calculate(model: Model, inputTokens: number, outputTokens: number): CostInfo {
    const cost = (inputTokens / 1_000_000) * model.inputPrice + (outputTokens / 1_000_000) * model.outputPrice;
    return { cost, inputTokens, outputTokens };
  }

  calculateForRole(role: string, inputTokens: number, outputTokens: number): CostInfo | null {
    const model = this.modelRepo.getRole(role);
    if (!model) return null;
    return this.calculate(model, inputTokens, outputTokens);
  }

  formatCost(info: CostInfo): string {
    const costStr = info.cost < 0.01
      ? `$${info.cost.toFixed(6)}`
      : `$${info.cost.toFixed(4)}`;
    return `💰 ${costStr} (${info.inputTokens} in / ${info.outputTokens} out)`;
  }

  formatMemoryCost(inputTokens: number, outputTokens: number, model: Model, status: string): string {
    const info = this.calculate(model, inputTokens, outputTokens);
    const costStr = info.cost < 0.01
      ? `$${info.cost.toFixed(6)}`
      : `$${info.cost.toFixed(4)}`;
    return `💡 ${status}: ${costStr} (${inputTokens} in / ${outputTokens} out)`;
  }

  accumulate(info: CostInfo): void {
    this.total.cost += info.cost;
    this.total.inputTokens += info.inputTokens;
    this.total.outputTokens += info.outputTokens;
  }

  getTotal(): CostInfo {
    return { ...this.total };
  }

  resetTotal(): void {
    this.total = { cost: 0, inputTokens: 0, outputTokens: 0 };
  }
}
