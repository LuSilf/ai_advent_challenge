import { describe, test, expect } from "bun:test";

import { RagService, buildRagPromptSuffix } from "./rag-service";
import type { Embedder } from "../ports/embedder";
import type { VectorIndex, VectorSearchFilter } from "../ports/vector-index";
import type { ChunkStrategy, ChunkWithVector, VectorSearchHit } from "../models/chunking";

class FakeEmbedder implements Embedder {
  readonly dimension = 3;
  public calls: string[][] = [];

  async embed(texts: string[]): Promise<Float32Array[]> {
    this.calls.push(texts);
    return texts.map(() => new Float32Array([1, 0, 0]));
  }
}

class FakeVectorIndex implements VectorIndex {
  public count = 0;
  public searchHits: VectorSearchHit[] = [];
  public lastSearch: { k: number; filter?: VectorSearchFilter } | null = null;

  upsert(_chunks: ChunkWithVector[]): void {}

  search(_queryVector: Float32Array, k: number, filter?: VectorSearchFilter): VectorSearchHit[] {
    this.lastSearch = { k, filter };
    return this.searchHits;
  }

  deleteByStrategy(_strategy: ChunkStrategy, _source?: string): number {
    return 0;
  }

  countByStrategy(_strategy: ChunkStrategy, _source?: string): number {
    return this.count;
  }
}

function makeHit(overrides: Partial<VectorSearchHit> = {}): VectorSearchHit {
  return {
    id: 1,
    strategy: "structural",
    source: "primer.md",
    title: "Primer",
    section: "Cache > When to update the cache",
    chunkIndex: 0,
    charStart: 0,
    charEnd: 100,
    text: "Write-through writes to cache and backing store immediately.",
    distance: 0.1234,
    ...overrides,
  };
}

describe("RagService", () => {
  test("returns no_index when there are no chunks for strategy", async () => {
    const embedder = new FakeEmbedder();
    const vectorIndex = new FakeVectorIndex();
    vectorIndex.count = 0;
    const service = new RagService(embedder, vectorIndex);

    const result = await service.retrieve("what is write-through?", {
      strategy: "structural",
      topK: 5,
    });

    expect(result.status).toBe("no_index");
    expect(result.hits).toEqual([]);
    expect(embedder.calls).toEqual([]);
    expect(vectorIndex.lastSearch).toBeNull();
  });

  test("returns no_hits when index exists but search is empty", async () => {
    const embedder = new FakeEmbedder();
    const vectorIndex = new FakeVectorIndex();
    vectorIndex.count = 10;
    const service = new RagService(embedder, vectorIndex);

    const result = await service.retrieve("what is write-through?", {
      strategy: "fixed",
      topK: 3,
    });

    expect(result.status).toBe("no_hits");
    expect(result.hits).toEqual([]);
    expect(embedder.calls).toEqual([["what is write-through?"]]);
    expect(vectorIndex.lastSearch).toEqual({
      k: 3,
      filter: { strategy: "fixed" },
    });
  });

  test("returns hits and prompt suffix when retrieval succeeds", async () => {
    const embedder = new FakeEmbedder();
    const vectorIndex = new FakeVectorIndex();
    vectorIndex.count = 10;
    vectorIndex.searchHits = [makeHit(), makeHit({ id: 2, section: "Cache > Cache-aside", distance: 0.3333 })];
    const service = new RagService(embedder, vectorIndex);

    const result = await service.retrieve("what is write-through?", {
      strategy: "structural",
      topK: 5,
    });

    expect(result.status).toBe("ok");
    expect(result.hits).toHaveLength(2);
    expect(result.promptSuffix).toContain("Найденные материалы");
    expect(result.promptSuffix).toContain("section=Cache > When to update the cache");
    expect(result.promptSuffix).toContain("distance=0.1234");
    expect(result.promptSuffix).toContain("Write-through writes to cache");
  });
});

describe("buildRagPromptSuffix", () => {
  test("includes source, section and distance for each hit", () => {
    const suffix = buildRagPromptSuffix([
      makeHit({ source: "a.md", section: "Section A", distance: 0.1111 }),
      makeHit({ id: 2, source: "b.md", section: null, distance: 0.2222 }),
    ]);

    expect(suffix).toContain("[Источник 1] source=a.md | section=Section A | distance=0.1111");
    expect(suffix).toContain("[Источник 2] source=b.md | section=(none) | distance=0.2222");
  });
});
