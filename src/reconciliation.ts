import type OpenAI from "openai";
import { getModelForRole } from "./db";

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

export function buildReconciliationInput(currentMemory: string, newContent: string): string {
  return `Текущая память:\n${currentMemory}\n\nНовый контент:\n${newContent}`;
}

export function buildExtractionInput(newContent: string): string {
  return `Контент для анализа:\n${newContent}`;
}

export function parseReconciliationResponse(response: string): { updatedMemory: string; changesSummary: string } {
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

export async function reconcileMemory(
  client: OpenAI,
  currentMemory: string,
  newContent: string,
): Promise<ReconciliationResult> {
  const factsModel = getModelForRole("facts");
  const modelId = factsModel?.id ?? "openai/gpt-5-nano";

  const isEmpty = !currentMemory;
  const instructions = isEmpty ? EXTRACTION_PROMPT : RECONCILIATION_PROMPT;
  const input = isEmpty
    ? buildExtractionInput(newContent)
    : buildReconciliationInput(currentMemory, newContent);

  const response = await client.responses.create({
    model: modelId,
    instructions,
    input,
    stream: false,
  });

  const inputTokens = response.usage?.input_tokens ?? 0;
  const outputTokens = response.usage?.output_tokens ?? 0;
  const text = response.output_text?.trim() ?? "";

  const { updatedMemory, changesSummary } = parseReconciliationResponse(text);

  return { updatedMemory, changesSummary, inputTokens, outputTokens };
}
