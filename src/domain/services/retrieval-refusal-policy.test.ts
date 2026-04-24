import { describe, test, expect } from "bun:test";
import { RetrievalRefusalPolicy } from "./retrieval-refusal-policy";
import type { PipelineRetrieveResult, RankedHit } from "./rag-pipeline-service";
import type { VectorSearchHit } from "../models/chunking";

function makeRankedHit(id: number, relevanceScore: number, distance = 0.5): RankedHit {
  const base: VectorSearchHit = {
    id,
    strategy: "structural",
    source: "test.md",
    title: null,
    section: `section-${id}`,
    chunkIndex: 0,
    charStart: 0,
    charEnd: 100,
    text: `chunk ${id}`,
    distance,
  };
  return { ...base, relevanceScore };
}

function okResult(rerankedHits: RankedHit[] | undefined): PipelineRetrieveResult {
  return {
    status: "ok",
    strategy: "structural",
    topK: 3,
    hits: rerankedHits ?? [],
    promptSuffix: "...",
    modeName: "rag-full",
    hitsBeforeFilter: (rerankedHits ?? []).length,
    rerankedHits,
  };
}

function noHitsResult(): PipelineRetrieveResult {
  return {
    status: "no_hits",
    strategy: "structural",
    topK: 3,
    hits: [],
    modeName: "rag-full",
    hitsBeforeFilter: 0,
  };
}

function insufficientResult(): PipelineRetrieveResult {
  return {
    status: "insufficient_context",
    strategy: "structural",
    topK: 3,
    hits: [],
    modeName: "rag-full",
    hitsBeforeFilter: 5,
  };
}

describe("RetrievalRefusalPolicy — status passthrough", () => {
  test("status=no_hits → refuse, reason=no_hits", () => {
    const policy = new RetrievalRefusalPolicy(0.5);
    const r = policy.decide(noHitsResult());
    expect(r.shouldRefuse).toBe(true);
    expect(r.reason).toBe("no_hits");
    expect(r.maxRelevanceScore).toBe(null);
  });

  test("status=insufficient_context → refuse, reason=insufficient_context", () => {
    const policy = new RetrievalRefusalPolicy(0.5);
    const r = policy.decide(insufficientResult());
    expect(r.shouldRefuse).toBe(true);
    expect(r.reason).toBe("insufficient_context");
    expect(r.maxRelevanceScore).toBe(null);
  });
});

describe("RetrievalRefusalPolicy — ok status with reranked hits", () => {
  test("single hit above threshold → no refuse", () => {
    const policy = new RetrievalRefusalPolicy(0.5);
    const r = policy.decide(okResult([makeRankedHit(1, 0.8)]));
    expect(r.shouldRefuse).toBe(false);
    expect(r.reason).toBe(null);
    expect(r.maxRelevanceScore).toBeCloseTo(0.8, 2);
  });

  test("single hit below threshold → refuse, reason=below_threshold", () => {
    const policy = new RetrievalRefusalPolicy(0.5);
    const r = policy.decide(okResult([makeRankedHit(1, 0.3)]));
    expect(r.shouldRefuse).toBe(true);
    expect(r.reason).toBe("below_threshold");
    expect(r.maxRelevanceScore).toBeCloseTo(0.3, 2);
  });

  test("three hits all below threshold → refuse, max from three", () => {
    const policy = new RetrievalRefusalPolicy(0.5);
    const r = policy.decide(
      okResult([makeRankedHit(1, 0.2), makeRankedHit(2, 0.4), makeRankedHit(3, 0.1)]),
    );
    expect(r.shouldRefuse).toBe(true);
    expect(r.maxRelevanceScore).toBeCloseTo(0.4, 2);
  });

  test("three hits, one above threshold → no refuse", () => {
    const policy = new RetrievalRefusalPolicy(0.5);
    const r = policy.decide(
      okResult([makeRankedHit(1, 0.2), makeRankedHit(2, 0.7), makeRankedHit(3, 0.1)]),
    );
    expect(r.shouldRefuse).toBe(false);
    expect(r.maxRelevanceScore).toBeCloseTo(0.7, 2);
  });

  test("empty rerankedHits array → refuse (consistent with no_hits)", () => {
    const policy = new RetrievalRefusalPolicy(0.5);
    const r = policy.decide(okResult([]));
    expect(r.shouldRefuse).toBe(true);
    expect(r.reason).toBe("below_threshold");
    expect(r.maxRelevanceScore).toBe(null);
  });

  test("rerankedHits undefined (no rerank ran) → refuse", () => {
    const policy = new RetrievalRefusalPolicy(0.5);
    const r = policy.decide(okResult(undefined));
    expect(r.shouldRefuse).toBe(true);
    expect(r.reason).toBe("below_threshold");
  });
});

describe("RetrievalRefusalPolicy — boundary conditions (strict <)", () => {
  test("hit relevance equals threshold → no refuse (strict <)", () => {
    const policy = new RetrievalRefusalPolicy(0.5);
    const r = policy.decide(okResult([makeRankedHit(1, 0.5)]));
    expect(r.shouldRefuse).toBe(false);
  });

  test("threshold=1.0, hit=1.0 → no refuse", () => {
    const policy = new RetrievalRefusalPolicy(1.0);
    const r = policy.decide(okResult([makeRankedHit(1, 1.0)]));
    expect(r.shouldRefuse).toBe(false);
  });

  test("threshold=0.0, hit=0.0 → no refuse", () => {
    const policy = new RetrievalRefusalPolicy(0.0);
    const r = policy.decide(okResult([makeRankedHit(1, 0.0)]));
    expect(r.shouldRefuse).toBe(false);
  });

  test("threshold=0.5, hit=0.499999 → refuse", () => {
    const policy = new RetrievalRefusalPolicy(0.5);
    const r = policy.decide(okResult([makeRankedHit(1, 0.499999)]));
    expect(r.shouldRefuse).toBe(true);
    expect(r.reason).toBe("below_threshold");
  });
});

describe("RetrievalRefusalPolicy — different thresholds", () => {
  test("threshold=0.3, score=0.4 → no refuse", () => {
    const policy = new RetrievalRefusalPolicy(0.3);
    expect(policy.decide(okResult([makeRankedHit(1, 0.4)])).shouldRefuse).toBe(false);
  });

  test("threshold=0.7, score=0.4 → refuse", () => {
    const policy = new RetrievalRefusalPolicy(0.7);
    expect(policy.decide(okResult([makeRankedHit(1, 0.4)])).shouldRefuse).toBe(true);
  });
});
