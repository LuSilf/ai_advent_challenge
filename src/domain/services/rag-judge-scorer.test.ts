import { describe, test, expect } from "bun:test";

import { attachJudgeScores } from "./rag-judge-scorer";
import type { RuleScoredEvaluatedQuestion } from "./rag-rules-scorer";
import type { JudgeScore } from "./rag-judge-service";

class FakeJudgeService {
  public calls: Array<{ answer: string; hasRetrieval: boolean }> = [];

  async judge(_question: any, answer: string, retrieval?: any): Promise<JudgeScore> {
    this.calls.push({ answer, hasRetrieval: Boolean(retrieval) });
    return {
      score: retrieval ? 3 : 1,
      verdict: retrieval ? "RAG better" : "Baseline weaker",
      modelId: "openai/gpt-5-nano",
      raw: "{}",
    };
  }
}

describe("attachJudgeScores", () => {
  test("adds judge scores to baseline and rag runs", async () => {
    const results: RuleScoredEvaluatedQuestion[] = [
      {
        question: {
          id: "q1",
          question: "What is cache-aside?",
          expectation: "Explain cache-aside.",
        },
        baseline: {
          answer: "baseline",
          costInfo: null,
          rules: {
            score: 1,
            maxScore: 2,
            matchedMustInclude: [],
            missedMustInclude: [],
            matchedNiceToHave: [],
            matchedSections: [],
            verdict: "partial",
          },
        },
        rag: {
          answer: "rag",
          costInfo: null,
          rules: {
            score: 2,
            maxScore: 2,
            matchedMustInclude: [],
            missedMustInclude: [],
            matchedNiceToHave: [],
            matchedSections: [],
            verdict: "strong",
          },
          retrieval: {
            status: "ok",
            strategy: "structural",
            topK: 5,
            promptSuffix: "ctx",
            hits: [],
          },
        },
      },
    ];

    const judgeService = new FakeJudgeService();
    const scored = await attachJudgeScores(results, judgeService as any);

    expect(judgeService.calls).toEqual([
      { answer: "baseline", hasRetrieval: false },
      { answer: "rag", hasRetrieval: true },
    ]);
    expect(scored[0]!.baseline.judge.score).toBe(1);
    expect(scored[0]!.rag.judge.score).toBe(3);
  });
});
