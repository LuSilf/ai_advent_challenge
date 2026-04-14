import { describe, test, expect } from "bun:test";
import { IndexingService } from "./indexing-service";
import type { Chunker } from "../ports/chunker";
import type { Embedder } from "../ports/embedder";
import type { VectorIndex, VectorSearchFilter } from "../ports/vector-index";
import type {
  Chunk,
  ChunkStrategy,
  ChunkWithVector,
  VectorSearchHit,
} from "../models/chunking";

function fakeChunk(
  strategy: ChunkStrategy,
  source: string,
  index: number,
  text: string
): Chunk {
  return {
    strategy,
    source,
    title: "Test",
    section: null,
    chunkIndex: index,
    charStart: index * 10,
    charEnd: index * 10 + text.length,
    text,
  };
}

class FakeChunker implements Chunker {
  public calls: Array<{ text: string; source: string }> = [];
  constructor(private readonly chunks: Chunk[]) {}
  chunk(text: string, source: string): Chunk[] {
    this.calls.push({ text, source });
    return this.chunks.map((c) => ({ ...c, source }));
  }
}

class FakeEmbedder implements Embedder {
  readonly dimension = 4;
  public calls: string[][] = [];
  embed(texts: string[]): Promise<Float32Array[]> {
    this.calls.push([...texts]);
    return Promise.resolve(texts.map((_, i) => new Float32Array([i + 1, 0, 0, 0])));
  }
}

class FakeVectorIndex implements VectorIndex {
  public upserts: ChunkWithVector[][] = [];
  public deleteCalls: Array<{ strategy: ChunkStrategy; source?: string }> = [];

  upsert(chunks: ChunkWithVector[]): void {
    this.upserts.push(chunks);
  }
  search(_queryVector: Float32Array, _k: number, _filter?: VectorSearchFilter): VectorSearchHit[] {
    return [];
  }
  deleteByStrategy(strategy: ChunkStrategy, source?: string): number {
    this.deleteCalls.push({ strategy, source });
    return 0;
  }
  countByStrategy(_strategy: ChunkStrategy, _source?: string): number {
    return 0;
  }
}

describe("IndexingService", () => {
  test("orchestrates chunker → embedder → vector index end-to-end", async () => {
    const chunks = [
      fakeChunk("fixed", "", 0, "alpha"),
      fakeChunk("fixed", "", 1, "beta"),
      fakeChunk("fixed", "", 2, "gamma"),
    ];
    const chunker = new FakeChunker(chunks);
    const embedder = new FakeEmbedder();
    const vectorIndex = new FakeVectorIndex();

    const service = new IndexingService({ chunker, embedder, vectorIndex });
    const stats = await service.indexFile({
      source: "doc.md",
      text: "whatever",
      strategy: "fixed",
    });

    expect(chunker.calls).toEqual([{ text: "whatever", source: "doc.md" }]);
    expect(embedder.calls.length).toBe(1);
    expect(embedder.calls[0]).toEqual(["alpha", "beta", "gamma"]);

    expect(vectorIndex.upserts.length).toBe(1);
    const upserted = vectorIndex.upserts[0]!;
    expect(upserted.length).toBe(3);
    expect(upserted[0]!.text).toBe("alpha");
    expect(upserted[0]!.embedding).toBeInstanceOf(Float32Array);
    expect(upserted[0]!.source).toBe("doc.md");

    expect(stats.chunkCount).toBe(3);
    expect(stats.minSize).toBe(4);
    expect(stats.maxSize).toBe(5);
    expect(stats.strategy).toBe("fixed");
    expect(stats.source).toBe("doc.md");
  });

  test("splits chunks into batches when batchSize is smaller", async () => {
    const chunks = Array.from({ length: 7 }, (_, i) => fakeChunk("fixed", "", i, `c${i}`));
    const chunker = new FakeChunker(chunks);
    const embedder = new FakeEmbedder();
    const vectorIndex = new FakeVectorIndex();

    const service = new IndexingService({ chunker, embedder, vectorIndex });
    await service.indexFile({
      source: "doc.md",
      text: "x",
      strategy: "fixed",
      batchSize: 3,
    });

    expect(embedder.calls.map((c) => c.length)).toEqual([3, 3, 1]);
    expect(vectorIndex.upserts.map((b) => b.length)).toEqual([3, 3, 1]);
  });

  test("rebuild=true deletes existing chunks for this strategy/source first", async () => {
    const chunker = new FakeChunker([fakeChunk("fixed", "", 0, "a")]);
    const embedder = new FakeEmbedder();
    const vectorIndex = new FakeVectorIndex();

    const service = new IndexingService({ chunker, embedder, vectorIndex });
    await service.indexFile({
      source: "doc.md",
      text: "x",
      strategy: "fixed",
      rebuild: true,
    });

    expect(vectorIndex.deleteCalls).toEqual([{ strategy: "fixed", source: "doc.md" }]);
  });

  test("observer is notified about chunks and each batch", async () => {
    const chunks = Array.from({ length: 5 }, (_, i) => fakeChunk("fixed", "", i, `c${i}`));
    const chunker = new FakeChunker(chunks);
    const embedder = new FakeEmbedder();
    const vectorIndex = new FakeVectorIndex();

    const chunksReadyCalls: number[] = [];
    const batchStartCalls: Array<{ i: number; total: number; size: number }> = [];
    const batchDoneCalls: Array<{ i: number; total: number }> = [];

    const service = new IndexingService({ chunker, embedder, vectorIndex });
    await service.indexFile({
      source: "doc.md",
      text: "x",
      strategy: "fixed",
      batchSize: 2,
      observer: {
        onChunksReady: (cs) => chunksReadyCalls.push(cs.length),
        onBatchStart: (i, total, size) => batchStartCalls.push({ i, total, size }),
        onBatchDone: (i, total) => batchDoneCalls.push({ i, total }),
      },
    });

    expect(chunksReadyCalls).toEqual([5]);
    expect(batchStartCalls).toEqual([
      { i: 0, total: 3, size: 2 },
      { i: 1, total: 3, size: 2 },
      { i: 2, total: 3, size: 1 },
    ]);
    expect(batchDoneCalls.length).toBe(3);
    expect(batchDoneCalls.map((c) => c.i)).toEqual([0, 1, 2]);
  });

  test("empty chunker output yields zero-count stats and no embedder/index calls", async () => {
    const chunker = new FakeChunker([]);
    const embedder = new FakeEmbedder();
    const vectorIndex = new FakeVectorIndex();

    const service = new IndexingService({ chunker, embedder, vectorIndex });
    const stats = await service.indexFile({
      source: "empty.md",
      text: "",
      strategy: "fixed",
    });

    expect(stats.chunkCount).toBe(0);
    expect(stats.avgSize).toBe(0);
    expect(embedder.calls.length).toBe(0);
    expect(vectorIndex.upserts.length).toBe(0);
  });
});
