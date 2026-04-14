import type { RuleScoredEvaluatedQuestion } from "./rag-rules-scorer";
import type { JudgeScore, RagJudgeService } from "./rag-judge-service";

export type JudgeScoredEvaluatedQuestion = Omit<RuleScoredEvaluatedQuestion, "baseline" | "rag"> & {
  baseline: RuleScoredEvaluatedQuestion["baseline"] & { judge: JudgeScore };
  rag: RuleScoredEvaluatedQuestion["rag"] & { judge: JudgeScore };
};

export async function attachJudgeScores(
  results: RuleScoredEvaluatedQuestion[],
  judgeService: RagJudgeService,
): Promise<JudgeScoredEvaluatedQuestion[]> {
  const scored: JudgeScoredEvaluatedQuestion[] = [];

  for (const result of results) {
    const baselineJudge = await judgeService.judge(result.question, result.baseline.answer);
    const ragJudge = await judgeService.judge(result.question, result.rag.answer, result.rag.retrieval);
    scored.push({
      ...result,
      baseline: {
        ...result.baseline,
        judge: baselineJudge,
      },
      rag: {
        ...result.rag,
        judge: ragJudge,
      },
    });
  }

  return scored;
}
