import type { Chunker } from "../ports/chunker";
import type { Embedder } from "../ports/embedder";
import type { VectorIndex } from "../ports/vector-index";
import type {
  Chunk,
  ChunkStrategy,
  ChunkWithVector,
  IndexingStats,
} from "../models/chunking";

export type IndexingServiceDeps = {
  chunker: Chunker;
  embedder: Embedder;
  vectorIndex: VectorIndex;
};

export type IndexingObserver = {
  onChunksReady?: (chunks: Chunk[]) => void;
  onBatchStart?: (batchIndex: number, totalBatches: number, batchSize: number) => void;
  onBatchDone?: (batchIndex: number, totalBatches: number, elapsedMs: number) => void;
};

export type IndexFileOptions = {
  source: string;
  text: string;
  strategy: ChunkStrategy;
  rebuild?: boolean;
  batchSize?: number;
  observer?: IndexingObserver;
};

const DEFAULT_BATCH_SIZE = 32;

export class IndexingService {
  constructor(private readonly deps: IndexingServiceDeps) {}

  async indexFile(opts: IndexFileOptions): Promise<IndexingStats> {
    const { chunker, embedder, vectorIndex } = this.deps;
    const started = performance.now();

    if (opts.rebuild) {
      vectorIndex.deleteByStrategy(opts.strategy, opts.source);
    }

    const chunks = chunker.chunk(opts.text, opts.source);
    opts.observer?.onChunksReady?.(chunks);

    const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
    const totalBatches = Math.max(1, Math.ceil(chunks.length / batchSize));
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batchIndex = Math.floor(i / batchSize);
      const batch = chunks.slice(i, i + batchSize);
      opts.observer?.onBatchStart?.(batchIndex, totalBatches, batch.length);
      const batchStart = performance.now();
      const vectors = await embedder.embed(batch.map((c) => c.text));
      const withVectors: ChunkWithVector[] = batch.map((c, idx) => ({
        ...c,
        embedding: vectors[idx]!,
      }));
      vectorIndex.upsert(withVectors);
      opts.observer?.onBatchDone?.(
        batchIndex,
        totalBatches,
        Math.round(performance.now() - batchStart)
      );
    }

    const elapsedMs = Math.round(performance.now() - started);
    return computeStats(opts.strategy, opts.source, chunks, elapsedMs);
  }
}

function computeStats(
  strategy: ChunkStrategy,
  source: string,
  chunks: Chunk[],
  elapsedMs: number
): IndexingStats {
  if (chunks.length === 0) {
    return { strategy, source, chunkCount: 0, avgSize: 0, minSize: 0, maxSize: 0, elapsedMs };
  }
  let total = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const c of chunks) {
    const size = c.text.length;
    total += size;
    if (size < min) min = size;
    if (size > max) max = size;
  }
  return {
    strategy,
    source,
    chunkCount: chunks.length,
    avgSize: Math.round(total / chunks.length),
    minSize: min,
    maxSize: max,
    elapsedMs,
  };
}
