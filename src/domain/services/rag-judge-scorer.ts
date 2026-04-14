import type { RuleScoredEvaluatedQuestion } from "./rag-rules-scorer";
import type { JudgeScore, RagJudgeService } from "./rag-judge-service";

export type JudgeScoredEvaluatedQuestion = Omit<RuleScoredEvaluatedQuestion, "baseline" | "rag"> & {
  baseline: RuleScoredEvaluatedQuestion["baseline"] & { judge: JudgeScore };
  rag: RuleScoredEvaluatedQuestion["rag"] & { judge: JudgeScore };
};

export type JudgeScoringObserver = {
  onQuestionStart?: (result: RuleScoredEvaluatedQuestion, index: number, total: number) => void;
  onBaselineJudgeStart?: (result: RuleScoredEvaluatedQuestion, index: number, total: number) => void;
  onRagJudgeStart?: (result: RuleScoredEvaluatedQuestion, index: number, total: number) => void;
  onQuestionDone?: (result: JudgeScoredEvaluatedQuestion, index: number, total: number) => void;
};

export async function attachJudgeScores(
  results: RuleScoredEvaluatedQuestion[],
  judgeService: RagJudgeService,
  observer?: JudgeScoringObserver,
): Promise<JudgeScoredEvaluatedQuestion[]> {
  const scored: JudgeScoredEvaluatedQuestion[] = [];
  const total = results.length;

  for (let index = 0; index < results.length; index++) {
    const result = results[index]!;
    observer?.onQuestionStart?.(result, index, total);
    observer?.onBaselineJudgeStart?.(result, index, total);
    const baselineJudge = await judgeService.judge(result.question, result.baseline.answer);
    observer?.onRagJudgeStart?.(result, index, total);
    const ragJudge = await judgeService.judge(result.question, result.rag.answer, result.rag.retrieval);
    const judgeScored: JudgeScoredEvaluatedQuestion = {
      ...result,
      baseline: {
        ...result.baseline,
        judge: baselineJudge,
      },
      rag: {
        ...result.rag,
        judge: ragJudge,
      },
    };
    scored.push(judgeScored);
    observer?.onQuestionDone?.(judgeScored, index, total);
  }

  return scored;
}
