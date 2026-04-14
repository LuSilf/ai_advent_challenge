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

export class RagEvaluationService {
  constructor(
    private readonly answerQuestion: AnswerQuestion,
    private readonly ragRetriever: RagRetriever,
  ) {}

  async evaluate(
    questions: ControlQuestion[],
    ragOptions: { strategy: ChunkStrategy; topK: number },
  ): Promise<EvaluatedQuestion[]> {
    const results: EvaluatedQuestion[] = [];

    for (const question of questions) {
      const baseline = await this.answerQuestion(question.question);
      const retrieval = await this.ragRetriever.retrieve(question.question, ragOptions);
      const rag = await this.answerQuestion(question.question, {
        userPromptSuffix: retrieval.status === "ok" ? retrieval.promptSuffix : undefined,
      });

      results.push({
        question,
        baseline,
        rag: {
          ...rag,
          retrieval,
        },
      });
    }

    return results;
  }
}
