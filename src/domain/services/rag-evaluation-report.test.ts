import { describe, test, expect } from "bun:test";

import { renderRagEvaluationReport } from "./rag-evaluation-report";
import type { EvaluatedQuestion } from "./rag-evaluation-service";

function sampleResult(): EvaluatedQuestion {
  return {
    question: {
      id: "q1",
      question: "What is cache-aside?",
      expectation: "Explain that cache-aside lazily loads into cache.",
      expectedSections: ["Cache > When to update the cache"],
    },
    baseline: {
      answer: "Baseline answer",
      costInfo: { cost: 0.00012, inputTokens: 10, outputTokens: 20 },
      rules: {
        score: 2,
        maxScore: 4,
        matchedMustInclude: ["cache-aside"],
        missedMustInclude: ["lazy"],
        matchedNiceToHave: [],
        matchedSections: [],
        verdict: "partial",
      },
    },
    rag: {
      answer: "RAG answer",
      costInfo: { cost: 0.00034, inputTokens: 30, outputTokens: 40 },
      rules: {
        score: 4,
        maxScore: 5,
        matchedMustInclude: ["cache-aside", "lazy"],
        missedMustInclude: [],
        matchedNiceToHave: [],
        matchedSections: ["Cache > When to update the cache"],
        verdict: "strong",
      },
      retrieval: {
        status: "ok",
        strategy: "structural",
        topK: 5,
        promptSuffix: "ctx",
        hits: [
          {
            id: 1,
            strategy: "structural",
            source: "primer.md",
            title: "Primer",
            section: "Cache > When to update the cache",
            chunkIndex: 0,
            charStart: 0,
            charEnd: 100,
            text: "Cache-aside lazily loads data into the cache.",
            distance: 0.1234,
          },
        ],
      },
    },
  };
}

describe("renderRagEvaluationReport", () => {
  test("renders summary, expectation, answers and retrieval metadata", () => {
    const report = renderRagEvaluationReport([sampleResult()], {
      strategy: "structural",
      topK: 5,
      generatedAt: "2026-04-14T00:00:00.000Z",
    });

    expect(report).toContain("# Day 22 — RAG answer comparison report");
    expect(report).toContain("| q1 | What is cache-aside? |");
    expect(report).toContain("**Expectation:** Explain that cache-aside lazily loads into cache.");
    expect(report).toContain("### Baseline (without RAG)");
    expect(report).toContain("### RAG answer");
    expect(report).toContain("Rules: 2/4 (partial)");
    expect(report).toContain("Rules: 4/5 (strong)");
    expect(report).toContain("source=primer.md; section=Cache > When to update the cache; distance=0.1234");
  });
});
