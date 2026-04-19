import type { CostInfo } from "../models";
import type { ChunkStrategy } from "../models/chunking";
import type { RagRetrieveResult, RagRetriever } from "./rag-service";

export type ControlQuestion = {
  id: string;
  question: string;
  expectation: string;
  expectedSections?: string[];
  mustInclude?: string[];
  niceToHave?: string[];
  outOfScope?: boolean;
};

export type AnswerRunResult = {
  answer: string;
  costInfo: CostInfo | null;
};

export type EvaluatedQuestion = {
  question: ControlQuestion;
  baseline: AnswerRunResult;
  rag: AnswerRunResult & {
    retrieval: RagRetrieveResult;
  };
};

export type AnswerQuestion = (
  question: string,
  options?: { userPromptSuffix?: string },
) => Promise<AnswerRunResult>;

export type RagEvaluationObserver = {
  onQuestionStart?: (question: ControlQuestion, index: number, total: number) => void;
  onBaselineStart?: (question: ControlQuestion, index: number, total: number) => void;
  onRetrievalStart?: (question: ControlQuestion, index: number, total: number) => void;
  onRagAnswerStart?: (question: ControlQuestion, index: number, total: number) => void;
  onQuestionDone?: (result: EvaluatedQuestion, index: number, total: number) => void;
};

export class RagEvaluationService {
  constructor(
    private readonly answerQuestion: AnswerQuestion,
    private readonly ragRetriever: RagRetriever,
  ) {}

  async evaluate(
    questions: ControlQuestion[],
    ragOptions: { strategy: ChunkStrategy; topK: number },
    observer?: RagEvaluationObserver,
  ): Promise<EvaluatedQuestion[]> {
    const results: EvaluatedQuestion[] = [];
    const total = questions.length;

    for (let index = 0; index < questions.length; index++) {
      const question = questions[index]!;
      observer?.onQuestionStart?.(question, index, total);

      observer?.onBaselineStart?.(question, index, total);
      const baseline = await this.answerQuestion(question.question);

      observer?.onRetrievalStart?.(question, index, total);
      const retrieval = await this.ragRetriever.retrieve(question.question, ragOptions);

      observer?.onRagAnswerStart?.(question, index, total);
      const rag = await this.answerQuestion(question.question, {
        userPromptSuffix: retrieval.status === "ok" ? retrieval.promptSuffix : undefined,
      });

      const evaluated: EvaluatedQuestion = {
        question,
        baseline,
        rag: {
          ...rag,
          retrieval,
        },
      };

      results.push(evaluated);
      observer?.onQuestionDone?.(evaluated, index, total);
    }

    return results;
  }
}
