import type { AnswerRun } from "./dual-backend-eval-service";
import type { ControlQuestion } from "./rag-evaluation-service";
import type { JudgeScore, RagJudgeService } from "./rag-judge-service";

export type JudgedAnswerRun = AnswerRun & {
  cloudJudge?: JudgeScore;
  localJudge?: JudgeScore;
  cloudJudgeError?: string;
  localJudgeError?: string;
};

export type JudgeRunMeta = {
  questionId: string;
  modeName: string;
  backendName: string;
  runIndex: number;
};

export type JudgeProgress = {
  index: number;
  total: number;
};

export type DualJudgeObserver = {
  onJudgeStart?: (meta: JudgeRunMeta, progress: JudgeProgress) => void;
  onJudgeDone?: (judged: JudgedAnswerRun, progress: JudgeProgress) => void;
};

const FAILED_PLACEHOLDER = "(failed)";

export class DualJudgeService {
  constructor(
    private readonly cloudJudge: RagJudgeService,
    private readonly localJudge: RagJudgeService,
  ) {}

  async judgeAll(
    runs: AnswerRun[],
    questions: ControlQuestion[],
    observer?: DualJudgeObserver,
  ): Promise<JudgedAnswerRun[]> {
    const byId = new Map<string, ControlQuestion>(questions.map((q) => [q.id, q]));
    const total = runs.length;
    const out: JudgedAnswerRun[] = [];

    for (let i = 0; i < runs.length; i++) {
      const run = runs[i]!;
      const question = byId.get(run.questionId);
      if (!question) {
        throw new Error(`Question ${run.questionId} not found in provided list`);
      }

      const progress: JudgeProgress = { index: i + 1, total };
      const meta: JudgeRunMeta = {
        questionId: run.questionId,
        modeName: run.modeName,
        backendName: run.backendName,
        runIndex: run.runIndex,
      };
      observer?.onJudgeStart?.(meta, progress);

      const answerForJudge = run.error ? FAILED_PLACEHOLDER : run.answer;

      const judged: JudgedAnswerRun = { ...run };
      try {
        judged.cloudJudge = await this.cloudJudge.judge(question, answerForJudge, run.retrieval);
      } catch (err) {
        judged.cloudJudgeError = err instanceof Error ? err.message : String(err);
      }
      try {
        judged.localJudge = await this.localJudge.judge(question, answerForJudge, run.retrieval);
      } catch (err) {
        judged.localJudgeError = err instanceof Error ? err.message : String(err);
      }

      out.push(judged);
      observer?.onJudgeDone?.(judged, progress);
    }

    return out;
  }
}
