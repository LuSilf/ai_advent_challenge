import { describe, test, expect, beforeEach } from "bun:test";
import { CostService } from "./cost-service";
import type { ModelRepository } from "../ports/model-repository";
import type { Model, ModelRole } from "../models";

const testModel: Model = {
  id: "test/model",
  name: "Test Model",
  inputPrice: 0.10,
  outputPrice: 0.40,
  contextSize: 100_000,
};

function createMockModelRepository(models: Model[] = [testModel]): ModelRepository {
  return {
    getAll: () => models,
    getById: (id) => models.find((m) => m.id === id) ?? null,
    getRole: (role) => models[0] ?? null,
    getRoles: () => models.map((m) => ({ role: "chat", modelId: m.id, modelName: m.name })),
    setRole: () => {},
  };
}

describe("CostService", () => {
  let service: CostService;
  let repo: ModelRepository;

  beforeEach(() => {
    repo = createMockModelRepository();
    service = new CostService(repo);
  });

  test("calculate returns correct cost info", () => {
    // input: 0.10 $/1M, output: 0.40 $/1M
    // 1000 in = 0.0001, 500 out = 0.0002 => total 0.0003
    const info = service.calculate(testModel, 1000, 500);
    expect(info.inputTokens).toBe(1000);
    expect(info.outputTokens).toBe(500);
    expect(info.cost).toBeCloseTo(0.0003, 8);
  });

  test("calculate with zero tokens returns zero cost", () => {
    const info = service.calculate(testModel, 0, 0);
    expect(info.cost).toBe(0);
  });

  test("formatCost formats small cost with 6 decimals", () => {
    const info = { cost: 0.000250, inputTokens: 1000, outputTokens: 500 };
    const result = service.formatCost(info);
    expect(result).toContain("$0.000250");
    expect(result).toContain("1000 in");
    expect(result).toContain("500 out");
  });

  test("formatCost formats larger cost with 4 decimals", () => {
    const info = { cost: 0.1234, inputTokens: 50000, outputTokens: 30000 };
    const result = service.formatCost(info);
    expect(result).toContain("$0.1234");
  });

  test("accumulate tracks total cost", () => {
    service.accumulate({ cost: 0.001, inputTokens: 100, outputTokens: 50 });
    service.accumulate({ cost: 0.002, inputTokens: 200, outputTokens: 100 });
    const total = service.getTotal();
    expect(total.cost).toBeCloseTo(0.003, 8);
    expect(total.inputTokens).toBe(300);
    expect(total.outputTokens).toBe(150);
  });

  test("getTotal returns zero initially", () => {
    const total = service.getTotal();
    expect(total.cost).toBe(0);
    expect(total.inputTokens).toBe(0);
    expect(total.outputTokens).toBe(0);
  });

  test("resetTotal clears accumulated cost", () => {
    service.accumulate({ cost: 0.001, inputTokens: 100, outputTokens: 50 });
    service.resetTotal();
    const total = service.getTotal();
    expect(total.cost).toBe(0);
    expect(total.inputTokens).toBe(0);
  });

  test("calculateForRole uses model from repository", () => {
    const info = service.calculateForRole("chat", 1000, 500);
    expect(info).not.toBeNull();
    expect(info!.cost).toBeCloseTo(0.0003, 8);
  });

  test("calculateForRole returns null for unknown role", () => {
    const emptyRepo = createMockModelRepository([]);
    const emptyService = new CostService({
      ...emptyRepo,
      getRole: () => null,
    });
    const info = emptyService.calculateForRole("unknown", 1000, 500);
    expect(info).toBeNull();
  });

  test("formatMemoryCost formats with status", () => {
    const result = service.formatMemoryCost(1000, 100, testModel, "Сохранено");
    expect(result).toContain("Сохранено");
    expect(result).toContain("1000 in / 100 out");
  });
});
