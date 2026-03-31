import { describe, test, expect, beforeEach } from "bun:test";
import { MemoryService } from "./memory-service";
import type { MemoryStore, MemoryType } from "../ports/memory-store";
import type { LLMClient, StreamEvent } from "../ports/llm-client";
import type { ModelRepository } from "../ports/model-repository";
import type { LLMRequest, LLMResponse, Model } from "../models";

const testModel: Model = {
  id: "test/facts-model",
  name: "Facts Model",
  inputPrice: 0.10,
  outputPrice: 0.40,
  contextSize: 100_000,
};

function createMockMemoryStore(): MemoryStore & { data: Record<MemoryType, string> } {
  const data: Record<MemoryType, string> = { longterm: "", working: "" };
  return {
    data,
    read: (type) => data[type],
    write: (type, content) => { data[type] = content; },
    append: (type, content) => {
      data[type] = data[type] ? data[type] + "\n\n---\n\n" + content : content;
    },
    getPath: (type) => type === "longterm" ? "/mock/memory.md" : "/mock/.ai/memory.md",
  };
}

function createMockLLMClient(responseJson: string): LLMClient {
  return {
    async send(): Promise<LLMResponse & { rawResponse?: unknown }> {
      return { content: responseJson, inputTokens: 50, outputTokens: 30 };
    },
    async *stream(): AsyncIterable<StreamEvent> {
      yield { type: "done", response: { content: responseJson, inputTokens: 50, outputTokens: 30 } };
    },
  };
}

function createMockModelRepo(): ModelRepository {
  return {
    getAll: () => [testModel],
    getById: () => testModel,
    getRole: () => testModel,
    getRoles: () => [{ role: "facts", modelId: testModel.id, modelName: testModel.name }],
    setRole: () => {},
  };
}

describe("MemoryService", () => {
  let service: MemoryService;
  let memoryStore: ReturnType<typeof createMockMemoryStore>;
  let modelRepo: ModelRepository;

  beforeEach(() => {
    memoryStore = createMockMemoryStore();
    modelRepo = createMockModelRepo();
  });

  test("reconcile extracts facts from new content", async () => {
    const llmClient = createMockLLMClient(
      '{"updated_memory": "# Факты\\n- язык: TypeScript", "changes_summary": "добавлен язык"}'
    );
    service = new MemoryService(memoryStore, llmClient, modelRepo);

    const result = await service.reconcile("working", "Пишем на TypeScript");
    expect(result.updatedMemory).toContain("TypeScript");
    expect(result.changesSummary).toContain("добавлен язык");
    expect(result.inputTokens).toBe(50);
    expect(result.outputTokens).toBe(30);
  });

  test("reconcile with existing memory updates it", async () => {
    memoryStore.data.working = "# Старые факты\n- старый факт";
    const llmClient = createMockLLMClient(
      '{"updated_memory": "# Обновлённые факты\\n- старый факт\\n- новый факт", "changes_summary": "добавлен новый факт"}'
    );
    service = new MemoryService(memoryStore, llmClient, modelRepo);

    const result = await service.reconcile("working", "Новый контент");
    expect(result.updatedMemory).toContain("новый факт");
    expect(result.updatedMemory).toContain("старый факт");
  });

  test("reconcile returns empty when no changes", async () => {
    const llmClient = createMockLLMClient('{"updated_memory": "", "changes_summary": ""}');
    service = new MemoryService(memoryStore, llmClient, modelRepo);

    const result = await service.reconcile("working", "тривиальный контент");
    expect(result.updatedMemory).toBe("");
    expect(result.changesSummary).toBe("");
  });

  test("getMemoryBlocks combines longterm and working", () => {
    memoryStore.data.longterm = "глобальные факты";
    memoryStore.data.working = "проектные факты";
    service = new MemoryService(memoryStore, createMockLLMClient("{}"), modelRepo);

    const blocks = service.getMemoryBlocks();
    expect(blocks).toContain("Долговременная память");
    expect(blocks).toContain("глобальные факты");
    expect(blocks).toContain("Рабочая память");
    expect(blocks).toContain("проектные факты");
  });

  test("getMemoryBlocks returns empty string when no memory", () => {
    service = new MemoryService(memoryStore, createMockLLMClient("{}"), modelRepo);
    expect(service.getMemoryBlocks()).toBe("");
  });

  test("readMemory returns content for type", () => {
    memoryStore.data.longterm = "some memory";
    service = new MemoryService(memoryStore, createMockLLMClient("{}"), modelRepo);
    expect(service.readMemory("longterm")).toBe("some memory");
  });

  test("writeMemory writes content", () => {
    service = new MemoryService(memoryStore, createMockLLMClient("{}"), modelRepo);
    service.writeMemory("working", "new content");
    expect(memoryStore.data.working).toBe("new content");
  });

  test("appendMemory appends content", () => {
    memoryStore.data.longterm = "existing";
    service = new MemoryService(memoryStore, createMockLLMClient("{}"), modelRepo);
    service.appendMemory("longterm", "new");
    expect(memoryStore.data.longterm).toContain("existing");
    expect(memoryStore.data.longterm).toContain("new");
  });

  test("getMemoryPath returns path from store", () => {
    service = new MemoryService(memoryStore, createMockLLMClient("{}"), modelRepo);
    expect(service.getMemoryPath("longterm")).toBe("/mock/memory.md");
    expect(service.getMemoryPath("working")).toBe("/mock/.ai/memory.md");
  });

  test("getFactsModel returns facts model", () => {
    service = new MemoryService(memoryStore, createMockLLMClient("{}"), modelRepo);
    expect(service.getFactsModel()).toBe(testModel);
  });

  test("checkShouldReconcile returns true at interval", () => {
    service = new MemoryService(memoryStore, createMockLLMClient("{}"), modelRepo);
    expect(service.checkShouldReconcile(3, 5)).toBe(false);
    expect(service.checkShouldReconcile(5, 5)).toBe(true);
    expect(service.checkShouldReconcile(10, 5)).toBe(true);
  });

  test("checkShouldReconcile returns false when interval is 0", () => {
    service = new MemoryService(memoryStore, createMockLLMClient("{}"), modelRepo);
    expect(service.checkShouldReconcile(100, 0)).toBe(false);
  });
});
