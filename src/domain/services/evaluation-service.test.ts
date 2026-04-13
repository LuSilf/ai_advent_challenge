import { describe, test, expect } from "bun:test";
import {
  isHit,
  evaluateQuery,
  computeRecallAt3,
  computeMRR,
  type EvalQuery,
} from "./evaluation-service";
import type { VectorSearchHit } from "../models/chunking";

function hit(partial: Partial<VectorSearchHit>): VectorSearchHit {
  return {
    id: 0,
    strategy: "fixed",
    source: "t.md",
    title: null,
    section: null,
    chunkIndex: 0,
    charStart: 0,
    charEnd: 0,
    text: "",
    distance: 0,
    ...partial,
  };
}

describe("isHit", () => {
  const expected: EvalQuery = {
    id: "q",
    query: "x",
    expected_section_contains: ["Cache", "Write-through"],
    expected_keywords: ["cache-aside", "lazy load"],
  };

  test("matches by section substring case-insensitively", () => {
    expect(isHit(hit({ section: "When to update the Cache" }), expected)).toBe(true);
  });

  test("matches by keyword inside text case-insensitively", () => {
    expect(isHit(hit({ text: "Here we talk about Cache-Aside pattern" }), expected)).toBe(true);
  });

  test("fails when neither section nor text matches", () => {
    expect(isHit(hit({ section: "Database", text: "replication stuff" }), expected)).toBe(false);
  });

  test("section match without keywords still counts", () => {
    const onlySection: EvalQuery = { id: "q", query: "x", expected_section_contains: ["Cache"] };
    expect(isHit(hit({ section: "Cache > Write-through" }), onlySection)).toBe(true);
  });

  test("keyword match without section match still counts", () => {
    const onlyKeywords: EvalQuery = { id: "q", query: "x", expected_keywords: ["csrf"] };
    expect(isHit(hit({ section: "Whatever", text: "CSRF protection via tokens" }), onlyKeywords)).toBe(
      true
    );
  });

  test("null section in hit does not crash and falls through to keyword check", () => {
    const kw: EvalQuery = { id: "q", query: "x", expected_keywords: ["sharding"] };
    expect(isHit(hit({ section: null, text: "sharding splits data" }), kw)).toBe(true);
  });
});

describe("evaluateQuery", () => {
  const query: EvalQuery = {
    id: "q01",
    query: "test",
    expected_keywords: ["needle"],
  };

  test("firstHitRank is 1 when first hit matches", () => {
    const r = evaluateQuery(
      [hit({ text: "needle in haystack" }), hit({ text: "nothing here" })],
      query
    );
    expect(r.firstHitRank).toBe(1);
  });

  test("firstHitRank is 2 when second hit matches", () => {
    const r = evaluateQuery(
      [hit({ text: "miss" }), hit({ text: "found the needle" }), hit({ text: "also miss" })],
      query
    );
    expect(r.firstHitRank).toBe(2);
  });

  test("firstHitRank is 0 when no hit matches", () => {
    const r = evaluateQuery([hit({ text: "miss" }), hit({ text: "another miss" })], query);
    expect(r.firstHitRank).toBe(0);
  });

  test("carries query metadata through", () => {
    const r = evaluateQuery([], query);
    expect(r.queryId).toBe("q01");
    expect(r.query).toBe("test");
    expect(r.hits).toEqual([]);
  });
});

describe("computeRecallAt3", () => {
  const r = (rank: number) => ({ queryId: "q", query: "x", hits: [], firstHitRank: rank });

  test("returns 0 for empty", () => {
    expect(computeRecallAt3([])).toBe(0);
  });

  test("returns 1 when every query has a hit", () => {
    expect(computeRecallAt3([r(1), r(2), r(3)])).toBe(1);
  });

  test("returns 0 when no query has a hit", () => {
    expect(computeRecallAt3([r(0), r(0), r(0)])).toBe(0);
  });

  test("returns proportion correctly", () => {
    expect(computeRecallAt3([r(1), r(0), r(2), r(0)])).toBe(0.5);
  });
});

describe("computeMRR", () => {
  const r = (rank: number) => ({ queryId: "q", query: "x", hits: [], firstHitRank: rank });

  test("returns 0 for empty", () => {
    expect(computeMRR([])).toBe(0);
  });

  test("all rank 1 → MRR = 1", () => {
    expect(computeMRR([r(1), r(1)])).toBe(1);
  });

  test("all rank 2 → MRR = 0.5", () => {
    expect(computeMRR([r(2), r(2)])).toBe(0.5);
  });

  test("mix of ranks averages reciprocals", () => {
    // (1/1 + 1/2 + 1/3 + 0) / 4 = (1 + 0.5 + 0.3333... + 0) / 4 ≈ 0.4583
    expect(computeMRR([r(1), r(2), r(3), r(0)])).toBeCloseTo(0.4583, 3);
  });

  test("only misses → MRR = 0", () => {
    expect(computeMRR([r(0), r(0)])).toBe(0);
  });
});
