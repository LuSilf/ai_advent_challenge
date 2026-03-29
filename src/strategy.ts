import { getMessages, getFacts, type Fact } from "./db";
import type { ChatMessage } from "./request";

export type StrategyResult = {
  messages: ChatMessage[];
  factsBlock?: string;
};

export interface ContextStrategy {
  readonly name: string;
  buildMessages(sessionId: number, historyLimit: number): StrategyResult;
}

export class FullStrategy implements ContextStrategy {
  readonly name = "full";

  buildMessages(sessionId: number): StrategyResult {
    const messages = getMessages(sessionId).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
    return { messages };
  }
}

export class SlidingWindowStrategy implements ContextStrategy {
  readonly name = "sliding";

  buildMessages(sessionId: number, historyLimit: number): StrategyResult {
    const messages = getMessages(sessionId, historyLimit).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
    return { messages };
  }
}

export class StickyFactsStrategy implements ContextStrategy {
  readonly name = "facts";

  buildMessages(sessionId: number, historyLimit: number): StrategyResult {
    const messages = getMessages(sessionId, historyLimit).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const facts = getFacts(sessionId);
    let factsBlock: string | undefined;
    if (facts.length > 0) {
      factsBlock = formatFactsBlock(facts);
    }

    return { messages, factsBlock };
  }
}

export function formatFactsBlock(facts: Fact[]): string {
  const lines = facts.map((f) => `- ${f.key}: ${f.value}`);
  return `Известные факты из диалога:\n${lines.join("\n")}`;
}

export const FACTS_EXTRACTION_PROMPT = `Ты — экстрактор фактов из диалога. Твоя задача — извлечь и обновить ключевые факты.

Правила:
1. Извлекай только важные факты: цели, ограничения, предпочтения, решения, договорённости, технические детали
2. Формат ответа — строго JSON объект: {"key1": "value1", "key2": "value2"}
3. Ключи — короткие описательные названия на русском
4. Значения — краткие, по существу
5. Если факт изменился — обнови его
6. Не удаляй существующие факты, если они не были явно опровергнуты
7. Отвечай ТОЛЬКО JSON объектом, без пояснений`;

export function buildFactsExtractionInput(
  currentFacts: Fact[],
  userMessage: string,
  assistantMessage: string
): string {
  let input = "";
  if (currentFacts.length > 0) {
    const factsObj: Record<string, string> = {};
    for (const f of currentFacts) {
      factsObj[f.key] = f.value;
    }
    input += `Текущие факты:\n${JSON.stringify(factsObj, null, 2)}\n\n`;
  }
  input += `Последний обмен:\nПользователь: ${userMessage}\nАссистент: ${assistantMessage}\n\nОбновлённые факты (JSON):`;
  return input;
}

export function parseFactsResponse(response: string): Fact[] {
  // Извлекаем JSON из ответа (может быть обёрнут в ```json ... ```)
  let jsonStr = response.trim();
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  const parsed = JSON.parse(jsonStr);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Ожидался JSON объект");
  }

  return Object.entries(parsed).map(([key, value]) => ({
    key,
    value: String(value),
  }));
}

const STRATEGY_NAMES = ["full", "sliding", "facts"] as const;
export type StrategyName = (typeof STRATEGY_NAMES)[number];

export function isValidStrategy(name: string): name is StrategyName {
  return (STRATEGY_NAMES as readonly string[]).includes(name);
}

export function createStrategy(name: string): ContextStrategy {
  switch (name) {
    case "full":
      return new FullStrategy();
    case "sliding":
      return new SlidingWindowStrategy();
    case "facts":
      return new StickyFactsStrategy();
    default:
      throw new Error(
        `Неизвестная стратегия: ${name}. Допустимые: ${STRATEGY_NAMES.join(", ")}`
      );
  }
}
