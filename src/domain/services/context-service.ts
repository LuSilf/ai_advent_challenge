import type { Message, Fact } from "../models";

export type ContextResult = {
  messages: Message[];
  factsBlock?: string;
};

const STRATEGY_NAMES = ["full", "sliding"] as const;
export type StrategyName = (typeof STRATEGY_NAMES)[number];

export class ContextService {
  readonly factsExtractionPrompt = `Ты — экстрактор фактов из диалога. Твоя задача — извлечь и обновить ключевые факты.

Правила:
1. Извлекай только важные факты: цели, ограничения, предпочтения, решения, договорённости, технические детали
2. Формат ответа — строго JSON объект: {"key1": "value1", "key2": "value2"}
3. Ключи — короткие описательные названия на русском
4. Значения — краткие, по существу
5. Если факт изменился — обнови его
6. Не удаляй существующие факты, если они не были явно опровергнуты
7. Отвечай ТОЛЬКО JSON объектом, без пояснений`;

  buildContext(
    messages: Message[],
    facts: Fact[],
    strategy: string,
    historyLimit: number,
  ): ContextResult {
    let selected: Message[];

    switch (strategy) {
      case "full":
        selected = messages;
        break;
      case "sliding":
        selected = messages.slice(-historyLimit);
        break;
      case "facts":
        selected = messages.slice(-historyLimit);
        break;
      default:
        selected = messages;
        break;
    }

    let factsBlock: string | undefined;
    if (strategy === "facts" && facts.length > 0) {
      factsBlock = this.formatFactsBlock(facts);
    }

    return { messages: selected, factsBlock };
  }

  formatFactsBlock(facts: Fact[]): string {
    const lines = facts.map((f) => `- ${f.key}: ${f.value}`);
    return `Известные факты из диалога:\n${lines.join("\n")}`;
  }

  buildFactsExtractionInput(
    currentFacts: Fact[],
    userMessage: string,
    assistantMessage: string,
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

  parseFactsResponse(response: string): Fact[] {
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

  getValidStrategies(): string[] {
    return [...STRATEGY_NAMES];
  }

  isValidStrategy(name: string): name is StrategyName {
    return (STRATEGY_NAMES as readonly string[]).includes(name);
  }
}
