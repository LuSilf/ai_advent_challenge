import type { Chunk, ChunkStrategy, ChunkWithVector, VectorSearchHit } from "../models/chunking";

export type VectorSearchFilter = {
  strategy?: ChunkStrategy;
  source?: string;
};

export interface VectorIndex {
  upsert(chunks: ChunkWithVector[]): void;
  search(queryVector: Float32Array, k: number, filter?: VectorSearchFilter): VectorSearchHit[];
  deleteByStrategy(strategy: ChunkStrategy, source?: string): number;
  countByStrategy(strategy: ChunkStrategy, source?: string): number;
}

export type { Chunk, ChunkWithVector, VectorSearchHit };
