import type { LLMRequest, LLMResponse, Model } from "../models";
import type { LLMClient } from "../ports/llm-client";
import type { MemoryRepository, MemoryType } from "../ports/memory-repository";
import type { ModelRepository } from "../ports/model-repository";

export type ReconciliationResult = {
  updatedMemory: string;
  changesSummary: string;
  inputTokens: number;
  outputTokens: number;
};

const RECONCILIATION_PROMPT = `Ты — помощник по управлению памятью. Тебе даны:
1. Текущее содержимое файла памяти (может быть пустым)
2. Новый контент для анализа

Твоя задача:
- Извлечь важные факты из нового контента: архитектурные решения, договорённости, ограничения, паттерны, ключевые технические детали, предпочтения пользователя
- Сравнить с текущей памятью
- Сформировать обновлённую версию памяти: добавить новое, обновить изменившееся, НЕ удалять существующее без явной причины
- НЕ сохранять: тривиальные факты, временные задачи, содержимое кода, общеизвестные вещи
- Переформулировать в чёткие, структурированные утверждения от третьего лица. Не копировать текст пользователя дословно

Ответ — строго JSON объект:
{"updated_memory": "<полный обновлённый текст памяти в формате markdown>", "changes_summary": "<краткое описание что добавлено/изменено>"}

Если изменений нет — верни:
{"updated_memory": "", "changes_summary": ""}`;

const EXTRACTION_PROMPT = `Ты — помощник по управлению памятью. Тебе дан контент для анализа.

Извлеки важные факты: архитектурные решения, договорённости, ограничения, паттерны, ключевые технические детали, предпочтения пользователя.
НЕ сохранять: тривиальные факты, временные задачи, содержимое кода, общеизвестные вещи.
Переформулируй в чёткие, структурированные утверждения от третьего лица. Не копируй текст дословно.

Ответ — строго JSON объект:
{"updated_memory": "<текст памяти в формате markdown>", "changes_summary": "<краткое описание извлечённых фактов>"}

Если важных фактов нет — верни:
{"updated_memory": "", "changes_summary": ""}`;

export class MemoryService {
  constructor(
    private readonly memoryRepo: MemoryRepository,
    private readonly llmClient: LLMClient,
    private readonly modelRepo: ModelRepository,
  ) {}

  async reconcile(type: MemoryType, newContent: string): Promise<ReconciliationResult> {
    const currentMemory = this.memoryRepo.read(type);
    const factsModel = this.modelRepo.getRole("facts");
    const modelId = factsModel?.id ?? "openai/gpt-5-nano";

    const isEmpty = !currentMemory;
    const instructions = isEmpty ? EXTRACTION_PROMPT : RECONCILIATION_PROMPT;
    const input = isEmpty
      ? `Контент для анализа:\n${newContent}`
      : `Текущая память:\n${currentMemory}\n\nНовый контент:\n${newContent}`;

    const request: LLMRequest = {
      messages: [],
      instructions,
      model: modelId,
      params: {},
    };

    // Override the send to pass our input directly
    const response = await this.llmClient.send({
      ...request,
      messages: [{ id: 0, sessionId: 0, role: "user", content: input, createdAt: "" }],
    });

    const text = response.content.trim();
    const { updatedMemory, changesSummary } = this.parseReconciliationResponse(text);

    return {
      updatedMemory,
      changesSummary,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
    };
  }

  getMemoryBlocks(): string {
    const parts: string[] = [];

    const longTerm = this.memoryRepo.read("longterm");
    if (longTerm) {
      parts.push(`[Долговременная память]\n${longTerm}`);
    }

    const working = this.memoryRepo.read("working");
    if (working) {
      parts.push(`[Рабочая память проекта]\n${working}`);
    }

    return parts.join("\n\n");
  }

  readMemory(type: MemoryType): string {
    return this.memoryRepo.read(type);
  }

  writeMemory(type: MemoryType, content: string): void {
    this.memoryRepo.write(type, content);
  }

  appendMemory(type: MemoryType, content: string): void {
    this.memoryRepo.append(type, content);
  }

  getFactsModel(): Model | null {
    return this.modelRepo.getRole("facts");
  }

  checkShouldReconcile(messageCount: number, interval: number): boolean {
    if (interval <= 0) return false;
    return messageCount >= interval;
  }

  private parseReconciliationResponse(response: string): { updatedMemory: string; changesSummary: string } {
    let jsonStr = response.trim();
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Ожидался JSON объект");
    }

    const updatedMemory = typeof parsed.updated_memory === "string" ? parsed.updated_memory.trim() : "";
    const changesSummary = typeof parsed.changes_summary === "string" ? parsed.changes_summary.trim() : "";

    return { updatedMemory, changesSummary };
  }
}
