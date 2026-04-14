import type { LLMClient } from "../ports/llm-client";
import type { ModelRepository } from "../ports/model-repository";
import type { ControlQuestion } from "./rag-evaluation-service";
import type { RagRetrieveResult } from "./rag-service";

export type JudgeScore = {
  score: 0 | 1 | 2 | 3;
  verdict: string;
  modelId: string;
  raw: string;
};

const JUDGE_INSTRUCTIONS = `Ты — строгий оценщик ответов на вопросы по базе знаний.

Оцени ответ по шкале 0..3:
- 0 = неверно, мимо вопроса или почти бесполезно
- 1 = частично верно, но с существенными пробелами
- 2 = в целом верно, но заметно неполно или смазано
- 3 = полный, корректный и качественный ответ

Правила:
1. Учитывай только качество ответа по ожиданию.
2. Если переданы ожидаемые секции и retrieval-данные, учитывай groundedness как дополнительный фактор.
3. Не требуй буквального совпадения формулировок.
4. Верни СТРОГО JSON объект вида {"score": 0..3, "verdict": "короткое объяснение"} без markdown и без дополнительных полей.`;

export class RagJudgeService {
  constructor(
    private readonly llmClient: LLMClient,
    private readonly modelRepo: ModelRepository,
  ) {}

  async judge(question: ControlQuestion, answer: string, retrieval?: RagRetrieveResult): Promise<JudgeScore> {
    const judgeModel = this.modelRepo.getRole("judge") ?? this.modelRepo.getRole("chat");
    const modelId = judgeModel?.id ?? "openai/gpt-5-nano";

    const response = await this.llmClient.send({
      model: modelId,
      instructions: JUDGE_INSTRUCTIONS,
      params: { stream: false },
      messages: [
        {
          id: 0,
          sessionId: 0,
          role: "user",
          content: buildJudgeInput(question, answer, retrieval),
          createdAt: "",
        },
      ],
    });

    const parsed = parseJudgeResponse(response.content);
    return {
      ...parsed,
      modelId,
      raw: response.content,
    };
  }
}

export function buildJudgeInput(question: ControlQuestion, answer: string, retrieval?: RagRetrieveResult): string {
  const lines = [
    `Вопрос: ${question.question}`,
    `Ожидание: ${question.expectation}`,
  ];
  if (question.expectedSections?.length) {
    lines.push(`Ожидаемые секции: ${question.expectedSections.join(", ")}`);
  }
  lines.push(`Ответ: ${answer || "(empty)"}`);
  lines.push(`Retrieval: ${summarizeRetrieval(retrieval)}`);
  return lines.join("\n\n");
}

export function parseJudgeResponse(raw: string): Pick<JudgeScore, "score" | "verdict"> {
  let json = raw.trim();
  const codeBlockMatch = json.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    json = codeBlockMatch[1]!.trim();
  }

  const parsed = JSON.parse(json) as { score?: unknown; verdict?: unknown };
  const score = clampScore(parsed.score);
  const verdict = typeof parsed.verdict === "string" && parsed.verdict.trim().length > 0
    ? parsed.verdict.trim()
    : "Без пояснения";

  return { score, verdict };
}

function clampScore(value: unknown): 0 | 1 | 2 | 3 {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  if (numeric <= 0) return 0;
  if (numeric >= 3) return 3;
  return Math.round(numeric) as 0 | 1 | 2 | 3;
}

function summarizeRetrieval(retrieval?: RagRetrieveResult): string {
  if (!retrieval) return "none";
  if (retrieval.status === "no_index") return `no_index (strategy=${retrieval.strategy})`;
  if (retrieval.status === "no_hits") return `no_hits (strategy=${retrieval.strategy}, topK=${retrieval.topK})`;
  const hits = retrieval.hits
    .map((hit) => `${hit.source} :: ${hit.section ?? "(none)"} :: ${hit.distance.toFixed(4)}`)
    .join(" | ");
  return `ok (strategy=${retrieval.strategy}, topK=${retrieval.topK}) ${hits}`;
}
