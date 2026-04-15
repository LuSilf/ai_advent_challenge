import { describe, test, expect } from "bun:test";

import { attachRuleScores, scoreAnswer } from "./rag-rules-scorer";
import type { EvaluatedQuestion } from "./rag-evaluation-service";

function sampleQuestion(): EvaluatedQuestion["question"] {
  return {
    id: "q1",
    question: "What is cache-aside?",
    expectation: "Explain cache-aside.",
    expectedSections: ["Cache > When to update the cache"],
    mustInclude: ["cache-aside", "lazy"],
    niceToHave: ["stale"],
  };
}

describe("scoreAnswer", () => {
  test("scores must-have and nice-to-have matches", () => {
    const result = scoreAnswer(sampleQuestion(), "Cache-aside is lazy and can lead to stale reads.");

    expect(result.score).toBe(5);
    expect(result.maxScore).toBe(5);
    expect(result.matchedMustInclude).toEqual(["cache-aside", "lazy"]);
    expect(result.matchedNiceToHave).toEqual(["stale"]);
    expect(result.verdict).toBe("strong");
  });

  test("adds section evidence for rag retrieval", () => {
    const result = scoreAnswer(sampleQuestion(), "Cache-aside is lazy.", {
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
          text: "...",
          distance: 0.1234,
        },
      ],
    });

    expect(result.score).toBe(5);
    expect(result.maxScore).toBe(6);
    expect(result.matchedSections).toEqual(["Cache > When to update the cache"]);
    expect(result.verdict).toBe("strong");
  });

  test("supports alternative spellings and languages via || separator", () => {
    const result = scoreAnswer(
      {
        ...sampleQuestion(),
        mustInclude: ["writes||записи", "reads||чтение", "replica||реплик"],
      },
      "Мастер принимает записи, а реплики обслуживают чтение.",
    );

    expect(result.matchedMustInclude).toEqual(["writes||записи", "reads||чтение", "replica||реплик"]);
    expect(result.score).toBe(6);
    expect(result.verdict).toBe("strong");
  });

  test("returns weak verdict when nothing matches", () => {
    const result = scoreAnswer(sampleQuestion(), "I do not know.");
    expect(result.score).toBe(0);
    expect(result.verdict).toBe("weak");
  });
});

describe("attachRuleScores", () => {
  test("adds rule scores to both baseline and rag runs", () => {
    const evaluated: EvaluatedQuestion[] = [
      {
        question: sampleQuestion(),
        baseline: {
          answer: "Cache-aside is lazy.",
          costInfo: null,
        },
        rag: {
          answer: "Cache-aside is lazy and may become stale.",
          costInfo: null,
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
                text: "...",
                distance: 0.1234,
              },
            ],
          },
        },
      },
    ];

    const scored = attachRuleScores(evaluated);

    expect(scored[0]!.baseline.rules).toBeDefined();
    expect(scored[0]!.rag.rules.matchedSections).toEqual(["Cache > When to update the cache"]);
  });
});
