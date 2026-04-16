import type { LLMClient } from "../ports/llm-client";
import type { ModelRepository } from "../ports/model-repository";
import type { CitedRagResponse } from "../models/cited-rag-response";

export type FaithfulnessScore = {
  score: 0 | 1 | 2 | 3;
  verdict: string;
  modelId: string;
};

const FAITHFULNESS_INSTRUCTIONS = `Ты — оценщик faithfulness (верности) RAG-ответа.

Тебе даны:
1. Ответ ассистента (answer)
2. Цитаты из базы знаний (quotes), на которые ответ ссылается

Оцени по шкале 0..3, насколько утверждения в ответе подтверждаются цитатами:
- 0 = ответ противоречит цитатам или не имеет к ним отношения
- 1 = ответ частично подтверждается цитатами, но содержит существенные утверждения без подтверждения
- 2 = ответ в целом подтверждается цитатами, но есть мелкие расхождения или дополнения без подтверждения
- 3 = все утверждения в ответе полностью подтверждаются предоставленными цитатами

Верни СТРОГО JSON: {"score": 0..3, "verdict": "короткое объяснение"}`;

export class FaithfulnessJudge {
  constructor(
    private readonly llmClient: LLMClient,
    private readonly modelRepo: ModelRepository,
  ) {}

  async judge(cited: CitedRagResponse): Promise<FaithfulnessScore> {
    if (cited.confidence === "insufficient" || cited.quotes.length === 0) {
      return { score: 0, verdict: "no quotes to evaluate", modelId: "skipped" };
    }

    const judgeModel = this.modelRepo.getRole("judge") ?? this.modelRepo.getRole("chat");
    const modelId = judgeModel?.id ?? "openai/gpt-5-nano";

    const quotesText = cited.quotes.map((q, i) => `[${q.sourceIndex}] "${q.text}"`).join("\n");
    const input = `Ответ: ${cited.answer}\n\nЦитаты:\n${quotesText}`;

    const response = await this.llmClient.send({
      model: modelId,
      instructions: FAITHFULNESS_INSTRUCTIONS,
      params: { stream: false },
      messages: [
        { id: 0, sessionId: 0, role: "user", content: input, createdAt: "" },
      ],
    });

    try {
      let json = response.content.trim();
      const codeBlockMatch = json.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (codeBlockMatch) json = codeBlockMatch[1]!.trim();

      const parsed = JSON.parse(json) as { score?: unknown; verdict?: unknown };
      const score = clampScore(parsed.score);
      const verdict = typeof parsed.verdict === "string" ? parsed.verdict.trim() : "Без пояснения";
      return { score, verdict, modelId };
    } catch {
      return { score: 0, verdict: `parse error: ${response.content.slice(0, 100)}`, modelId };
    }
  }
}

function clampScore(value: unknown): 0 | 1 | 2 | 3 {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  if (numeric <= 0) return 0;
  if (numeric >= 3) return 3;
  return Math.round(numeric) as 0 | 1 | 2 | 3;
}
