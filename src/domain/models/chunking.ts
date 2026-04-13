export type ChunkStrategy = "fixed" | "structural";

export type Chunk = {
  id?: number;
  strategy: ChunkStrategy;
  source: string;
  title: string | null;
  section: string | null;
  chunkIndex: number;
  charStart: number;
  charEnd: number;
  text: string;
};

export type ChunkWithVector = Chunk & {
  embedding: Float32Array;
};

export type IndexingStats = {
  strategy: ChunkStrategy;
  source: string;
  chunkCount: number;
  avgSize: number;
  minSize: number;
  maxSize: number;
  elapsedMs: number;
};

export type VectorSearchHit = Chunk & {
  distance: number;
};
