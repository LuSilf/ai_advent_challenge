import { describe, test, expect } from "bun:test";

import { RagEvaluationService, type AnswerRunResult, type ControlQuestion } from "./rag-evaluation-service";
import type { RagRetrieveResult, RagRetriever } from "./rag-service";

class FakeRetriever implements RagRetriever {
  public calls: Array<{ question: string; strategy: string; topK: number }> = [];

  async retrieve(question: string, options: { strategy: any; topK: number }): Promise<RagRetrieveResult> {
    this.calls.push({ question, strategy: options.strategy, topK: options.topK });
    return {
      status: "ok",
      strategy: options.strategy,
      topK: options.topK,
      hits: [],
      promptSuffix: `ctx for ${question}`,
    };
  }
}

describe("RagEvaluationService", () => {
  test("runs each question in baseline and rag mode", async () => {
    const calls: Array<{ question: string; suffix?: string }> = [];
    const answerQuestion = async (question: string, options?: { userPromptSuffix?: string }): Promise<AnswerRunResult> => {
      calls.push({ question, suffix: options?.userPromptSuffix });
      return {
        answer: options?.userPromptSuffix ? `rag:${question}` : `base:${question}`,
        costInfo: null,
      };
    };
    const retriever = new FakeRetriever();
    const service = new RagEvaluationService(answerQuestion, retriever);
    const questions: ControlQuestion[] = [
      { id: "q1", question: "What is cache-aside?", expectation: "Explain cache-aside." },
      { id: "q2", question: "What is CAP theorem?", expectation: "Explain CAP." },
    ];

    const result = await service.evaluate(questions, { strategy: "structural", topK: 5 });

    expect(retriever.calls).toEqual([
      { question: "What is cache-aside?", strategy: "structural", topK: 5 },
      { question: "What is CAP theorem?", strategy: "structural", topK: 5 },
    ]);
    expect(calls).toEqual([
      { question: "What is cache-aside?", suffix: undefined },
      { question: "What is cache-aside?", suffix: "ctx for What is cache-aside?" },
      { question: "What is CAP theorem?", suffix: undefined },
      { question: "What is CAP theorem?", suffix: "ctx for What is CAP theorem?" },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]!.baseline.answer).toBe("base:What is cache-aside?");
    expect(result[0]!.rag.answer).toBe("rag:What is cache-aside?");
    expect(result[0]!.rag.retrieval.status).toBe("ok");
  });
});
