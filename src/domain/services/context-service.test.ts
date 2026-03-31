import { describe, test, expect } from "bun:test";
import { ContextService } from "./context-service";
import type { Message, Fact } from "../models";

function makeMessages(count: number): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    sessionId: 1,
    role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    content: `message ${i + 1}`,
    createdAt: new Date().toISOString(),
  }));
}

const testFacts: Fact[] = [
  { key: "язык", value: "TypeScript" },
  { key: "цель", value: "рефакторинг" },
];

describe("ContextService", () => {
  let service: ContextService;

  test("full strategy returns all messages", () => {
    service = new ContextService();
    const messages = makeMessages(10);
    const result = service.buildContext(messages, [], "full", 50);
    expect(result.messages).toHaveLength(10);
    expect(result.factsBlock).toBeUndefined();
  });

  test("sliding strategy returns last N messages", () => {
    service = new ContextService();
    const messages = makeMessages(10);
    const result = service.buildContext(messages, [], "sliding", 4);
    expect(result.messages).toHaveLength(4);
    expect(result.messages[0].content).toBe("message 7");
    expect(result.messages[3].content).toBe("message 10");
  });

  test("sliding strategy with limit larger than messages returns all", () => {
    service = new ContextService();
    const messages = makeMessages(3);
    const result = service.buildContext(messages, [], "sliding", 10);
    expect(result.messages).toHaveLength(3);
  });

  test("facts strategy returns sliding + facts block", () => {
    service = new ContextService();
    const messages = makeMessages(10);
    const result = service.buildContext(messages, testFacts, "facts", 4);
    expect(result.messages).toHaveLength(4);
    expect(result.factsBlock).toBeDefined();
    expect(result.factsBlock).toContain("язык");
    expect(result.factsBlock).toContain("TypeScript");
  });

  test("facts strategy with no facts returns no factsBlock", () => {
    service = new ContextService();
    const messages = makeMessages(5);
    const result = service.buildContext(messages, [], "facts", 4);
    expect(result.factsBlock).toBeUndefined();
  });

  test("formatFactsBlock formats facts correctly", () => {
    service = new ContextService();
    const block = service.formatFactsBlock(testFacts);
    expect(block).toContain("Известные факты из диалога:");
    expect(block).toContain("- язык: TypeScript");
    expect(block).toContain("- цель: рефакторинг");
  });

  test("buildFactsExtractionInput includes current facts and exchange", () => {
    service = new ContextService();
    const input = service.buildFactsExtractionInput(testFacts, "Привет", "Здравствуйте");
    expect(input).toContain("Текущие факты:");
    expect(input).toContain("TypeScript");
    expect(input).toContain("Привет");
    expect(input).toContain("Здравствуйте");
  });

  test("buildFactsExtractionInput without current facts", () => {
    service = new ContextService();
    const input = service.buildFactsExtractionInput([], "Привет", "Здравствуйте");
    expect(input).not.toContain("Текущие факты:");
    expect(input).toContain("Привет");
  });

  test("parseFactsResponse parses JSON", () => {
    service = new ContextService();
    const facts = service.parseFactsResponse('{"язык": "Python", "версия": "3.12"}');
    expect(facts).toHaveLength(2);
    expect(facts.find((f) => f.key === "язык")!.value).toBe("Python");
  });

  test("parseFactsResponse handles code block wrapping", () => {
    service = new ContextService();
    const facts = service.parseFactsResponse('```json\n{"test": "value"}\n```');
    expect(facts).toHaveLength(1);
    expect(facts[0]).toEqual({ key: "test", value: "value" });
  });

  test("parseFactsResponse throws on invalid JSON", () => {
    service = new ContextService();
    expect(() => service.parseFactsResponse("not json")).toThrow();
  });

  test("FACTS_EXTRACTION_PROMPT is defined", () => {
    service = new ContextService();
    expect(service.factsExtractionPrompt).toBeDefined();
    expect(service.factsExtractionPrompt.length).toBeGreaterThan(0);
  });

  test("getValidStrategies returns available strategies", () => {
    service = new ContextService();
    const strategies = service.getValidStrategies();
    expect(strategies).toContain("full");
    expect(strategies).toContain("sliding");
  });

  test("isValidStrategy checks strategy name", () => {
    service = new ContextService();
    expect(service.isValidStrategy("full")).toBe(true);
    expect(service.isValidStrategy("sliding")).toBe(true);
    expect(service.isValidStrategy("unknown")).toBe(false);
  });
});
