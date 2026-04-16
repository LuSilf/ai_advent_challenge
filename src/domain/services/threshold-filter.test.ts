import { describe, test, expect } from "bun:test";
import { filterByThreshold } from "./threshold-filter";
import type { VectorSearchHit } from "../models/chunking";

function makeHit(distance: number, id = 1): VectorSearchHit {
  return {
    id,
    strategy: "structural",
    source: "test.md",
    title: null,
    section: `section-${id}`,
    chunkIndex: 0,
    charStart: 0,
    charEnd: 100,
    text: `chunk text ${id}`,
    distance,
  };
}

describe("filterByThreshold", () => {
  test("filters out hits above threshold", () => {
    const hits = [makeHit(0.5, 1), makeHit(0.8, 2), makeHit(0.9, 3)];
    const result = filterByThreshold(hits, 0.85);
    expect(result.accepted).toHaveLength(2);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.id).toBe(3);
  });

  test("includes hits exactly at threshold", () => {
    const hits = [makeHit(0.85, 1)];
    const result = filterByThreshold(hits, 0.85);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  test("returns empty arrays for empty input", () => {
    const result = filterByThreshold([], 0.85);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
  });

  test("accepts all hits when threshold is high", () => {
    const hits = [makeHit(0.5, 1), makeHit(0.8, 2), makeHit(0.9, 3)];
    const result = filterByThreshold(hits, 1.0);
    expect(result.accepted).toHaveLength(3);
    expect(result.rejected).toHaveLength(0);
  });

  test("rejects all hits when threshold is very low", () => {
    const hits = [makeHit(0.5, 1), makeHit(0.8, 2)];
    const result = filterByThreshold(hits, 0.1);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(2);
  });

  test("preserves order of hits", () => {
    const hits = [makeHit(0.3, 1), makeHit(0.7, 2), makeHit(0.5, 3)];
    const result = filterByThreshold(hits, 0.85);
    expect(result.accepted.map((h) => h.id)).toEqual([1, 2, 3]);
  });
});
