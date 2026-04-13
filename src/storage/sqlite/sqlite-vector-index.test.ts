import { describe, test, expect, beforeEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteVectorIndex } from "./sqlite-vector-index";
import { initDb } from "../../db";
import type { ChunkWithVector } from "../../domain/models/chunking";

function freshDb(): void {
  const path = join(tmpdir(), `test-vector-index-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  initDb(path);
}

function unit(dim: number, axis: number): Float32Array {
  const v = new Float32Array(dim);
  v[axis] = 1;
  return v;
}

function makeChunk(
  strategy: "fixed" | "structural",
  chunkIndex: number,
  text: string,
  embedding: Float32Array,
  source = "test.md"
): ChunkWithVector {
  return {
    strategy,
    source,
    title: "Test Doc",
    section: strategy === "structural" ? `Section ${chunkIndex}` : null,
    chunkIndex,
    charStart: chunkIndex * 100,
    charEnd: chunkIndex * 100 + text.length,
    text,
    embedding,
  };
}

describe("SqliteVectorIndex", () => {
  let index: SqliteVectorIndex;

  beforeEach(() => {
    freshDb();
    index = new SqliteVectorIndex();
  });

  test("empty index returns no search hits", () => {
    const hits = index.search(unit(768, 0), 5);
    expect(hits).toEqual([]);
  });

  test("upsert and search returns nearest vector first", () => {
    index.upsert([
      makeChunk("fixed", 0, "alpha", unit(768, 0)),
      makeChunk("fixed", 1, "beta", unit(768, 1)),
      makeChunk("fixed", 2, "gamma", unit(768, 2)),
    ]);

    const hits = index.search(unit(768, 0), 3);

    expect(hits.length).toBe(3);
    expect(hits[0]!.text).toBe("alpha");
    expect(hits[0]!.distance).toBeCloseTo(0, 5);
    expect(hits[0]!.chunkIndex).toBe(0);
    expect(hits[0]!.strategy).toBe("fixed");
    expect(hits[0]!.title).toBe("Test Doc");
  });

  test("search k limits the number of returned hits", () => {
    index.upsert([
      makeChunk("fixed", 0, "a", unit(768, 0)),
      makeChunk("fixed", 1, "b", unit(768, 1)),
      makeChunk("fixed", 2, "c", unit(768, 2)),
      makeChunk("fixed", 3, "d", unit(768, 3)),
    ]);

    const hits = index.search(unit(768, 0), 2);
    expect(hits.length).toBe(2);
  });

  test("search filters by strategy", () => {
    index.upsert([
      makeChunk("fixed", 0, "fixed-a", unit(768, 0)),
      makeChunk("fixed", 1, "fixed-b", unit(768, 1)),
      makeChunk("structural", 0, "struct-a", unit(768, 0)),
      makeChunk("structural", 1, "struct-b", unit(768, 1)),
    ]);

    const fixedHits = index.search(unit(768, 0), 5, { strategy: "fixed" });
    expect(fixedHits.length).toBe(2);
    for (const h of fixedHits) {
      expect(h.strategy).toBe("fixed");
    }

    const structHits = index.search(unit(768, 0), 5, { strategy: "structural" });
    expect(structHits.length).toBe(2);
    for (const h of structHits) {
      expect(h.strategy).toBe("structural");
    }
  });

  test("countByStrategy returns per-strategy counts", () => {
    index.upsert([
      makeChunk("fixed", 0, "f1", unit(768, 0)),
      makeChunk("fixed", 1, "f2", unit(768, 1)),
      makeChunk("structural", 0, "s1", unit(768, 2)),
    ]);

    expect(index.countByStrategy("fixed")).toBe(2);
    expect(index.countByStrategy("structural")).toBe(1);
  });

  test("deleteByStrategy removes chunks and vectors for that strategy only", () => {
    index.upsert([
      makeChunk("fixed", 0, "f1", unit(768, 0)),
      makeChunk("fixed", 1, "f2", unit(768, 1)),
      makeChunk("structural", 0, "s1", unit(768, 2)),
    ]);

    const removed = index.deleteByStrategy("fixed");
    expect(removed).toBe(2);
    expect(index.countByStrategy("fixed")).toBe(0);
    expect(index.countByStrategy("structural")).toBe(1);

    const hits = index.search(unit(768, 0), 5);
    expect(hits.length).toBe(1);
    expect(hits[0]!.strategy).toBe("structural");
  });

  test("re-upserting after delete allows idempotent full rebuild", () => {
    const first: ChunkWithVector[] = [
      makeChunk("fixed", 0, "v1", unit(768, 0)),
      makeChunk("fixed", 1, "v1-b", unit(768, 1)),
    ];
    index.upsert(first);
    expect(index.countByStrategy("fixed")).toBe(2);

    index.deleteByStrategy("fixed");
    index.upsert([
      makeChunk("fixed", 0, "v2", unit(768, 0)),
      makeChunk("fixed", 1, "v2-b", unit(768, 1)),
      makeChunk("fixed", 2, "v2-c", unit(768, 2)),
    ]);

    expect(index.countByStrategy("fixed")).toBe(3);
    const hits = index.search(unit(768, 0), 1, { strategy: "fixed" });
    expect(hits[0]!.text).toBe("v2");
  });

  test("upsert with empty array is a no-op", () => {
    index.upsert([]);
    expect(index.countByStrategy("fixed")).toBe(0);
  });
});
