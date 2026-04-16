import { describe, test, expect } from "bun:test";
import { RagPipelineService, type RagMode, type Reranker, type QueryRewriter, type RankedHit } from "./rag-pipeline-service";
import type { Embedder } from "../ports/embedder";
import type { VectorIndex, VectorSearchFilter } from "../ports/vector-index";
import type { VectorSearchHit, ChunkWithVector, ChunkStrategy } from "../models/chunking";

function makeHit(id: number, distance: number): VectorSearchHit {
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

function createMockEmbedder(): Embedder {
  return {
    dimension: 768,
    embed: async () => [new Float32Array(768)],
  };
}

function createMockVectorIndex(hits: VectorSearchHit[], count = 10): VectorIndex {
  return {
    search: () => hits,
    countByStrategy: () => count,
    upsert: () => {},
    deleteByStrategy: () => 0,
  };
}

describe("RagPipelineService", () => {
  test("plain mode returns topKFinal hits without filtering", async () => {
    const hits = [makeHit(1, 0.5), makeHit(2, 0.7), makeHit(3, 0.9)];
    const mode: RagMode = {
      name: "rag-plain",
      strategy: "structural",
      topKInitial: 10,
      topKFinal: 2,
    };
    const service = new RagPipelineService(createMockEmbedder(), createMockVectorIndex(hits), mode);
    const result = await service.retrieve("test question");

    expect(result.status).toBe("ok");
    expect(result.hits).toHaveLength(2);
    expect(result.modeName).toBe("rag-plain");
    expect(result.hitsBeforeFilter).toBe(3);
    expect(result.thresholdFilter).toBeUndefined();
    expect(result.rewrittenQuery).toBeUndefined();
  });

  test("threshold mode filters hits by distance", async () => {
    const hits = [makeHit(1, 0.5), makeHit(2, 0.7), makeHit(3, 0.9)];
    const mode: RagMode = {
      name: "rag-threshold",
      strategy: "structural",
      topKInitial: 10,
      topKFinal: 3,
      threshold: 0.8,
    };
    const service = new RagPipelineService(createMockEmbedder(), createMockVectorIndex(hits), mode);
    const result = await service.retrieve("test question");

    expect(result.status).toBe("ok");
    expect(result.hits).toHaveLength(2);
    expect(result.thresholdFilter?.rejected).toHaveLength(1);
    expect(result.thresholdFilter?.rejected[0]!.id).toBe(3);
  });

  test("threshold filters everything returns insufficient_context", async () => {
    const hits = [makeHit(1, 0.9), makeHit(2, 0.95)];
    const mode: RagMode = {
      name: "rag-threshold",
      strategy: "structural",
      topKInitial: 10,
      topKFinal: 3,
      threshold: 0.5,
    };
    const service = new RagPipelineService(createMockEmbedder(), createMockVectorIndex(hits), mode);
    const result = await service.retrieve("test question");

    expect(result.status).toBe("insufficient_context");
    expect(result.hits).toHaveLength(0);
    expect(result.hitsBeforeFilter).toBe(2);
  });

  test("empty index returns no_index", async () => {
    const mode: RagMode = {
      name: "test",
      strategy: "structural",
      topKInitial: 10,
      topKFinal: 3,
    };
    const service = new RagPipelineService(createMockEmbedder(), createMockVectorIndex([], 0), mode);
    const result = await service.retrieve("test");

    expect(result.status).toBe("no_index");
  });

  test("reranker is called and results are sorted by relevance", async () => {
    const hits = [makeHit(1, 0.5), makeHit(2, 0.6), makeHit(3, 0.7)];
    const reranker: Reranker = {
      rerank: async (_query, inputHits) =>
        inputHits.map((h, i) => ({
          ...h,
          relevanceScore: i === 2 ? 0.9 : i === 0 ? 0.3 : 0.1,
        })).sort((a, b) => b.relevanceScore - a.relevanceScore),
    };
    const mode: RagMode = {
      name: "rag-reranker",
      strategy: "structural",
      topKInitial: 10,
      topKFinal: 2,
      reranker,
    };
    const service = new RagPipelineService(createMockEmbedder(), createMockVectorIndex(hits), mode);
    const result = await service.retrieve("test");

    expect(result.status).toBe("ok");
    expect(result.hits).toHaveLength(2);
    expect(result.hits[0]!.id).toBe(3);
    expect(result.rerankedHits).toHaveLength(3);
  });

  test("query rewriter transforms the query before embedding", async () => {
    let embeddedText = "";
    const embedder: Embedder = {
      dimension: 768,
      embed: async (texts) => {
        embeddedText = texts[0]!;
        return [new Float32Array(768)];
      },
    };
    const queryRewriter: QueryRewriter = {
      rewrite: async () => "expanded technical query about caching strategies",
    };
    const mode: RagMode = {
      name: "rag-full",
      strategy: "structural",
      topKInitial: 10,
      topKFinal: 3,
      queryRewriter,
    };
    const hits = [makeHit(1, 0.5)];
    const service = new RagPipelineService(embedder, createMockVectorIndex(hits), mode);
    const result = await service.retrieve("what is caching?");

    expect(embeddedText).toBe("expanded technical query about caching strategies");
    expect(result.rewrittenQuery).toBe("expanded technical query about caching strategies");
  });

  test("full pipeline: rewrite + threshold + reranker", async () => {
    const hits = [makeHit(1, 0.5), makeHit(2, 0.7), makeHit(3, 0.9)];
    const reranker: Reranker = {
      rerank: async (_query, inputHits) =>
        inputHits.map((h) => ({ ...h, relevanceScore: 0.8 })),
    };
    const queryRewriter: QueryRewriter = {
      rewrite: async () => "rewritten query",
    };
    const mode: RagMode = {
      name: "rag-full",
      strategy: "structural",
      topKInitial: 10,
      topKFinal: 2,
      threshold: 0.8,
      reranker,
      queryRewriter,
    };
    const service = new RagPipelineService(createMockEmbedder(), createMockVectorIndex(hits), mode);
    const result = await service.retrieve("test");

    expect(result.status).toBe("ok");
    expect(result.rewrittenQuery).toBe("rewritten query");
    expect(result.thresholdFilter?.rejected).toHaveLength(1);
    expect(result.hits).toHaveLength(2);
  });
});
