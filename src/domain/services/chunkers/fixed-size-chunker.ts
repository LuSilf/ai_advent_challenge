import type { Chunker } from "../../ports/chunker";
import type { Chunk } from "../../models/chunking";

export type FixedSizeChunkerConfig = {
  size: number;
  overlap: number;
};

const TITLE_REGEX = /^#\s+(.+)$/m;

export class FixedSizeChunker implements Chunker {
  constructor(private readonly config: FixedSizeChunkerConfig) {
    if (config.size <= 0) {
      throw new Error(`FixedSizeChunker: size must be > 0, got ${config.size}`);
    }
    if (config.overlap < 0) {
      throw new Error(`FixedSizeChunker: overlap must be >= 0, got ${config.overlap}`);
    }
    if (config.overlap >= config.size) {
      throw new Error(
        `FixedSizeChunker: overlap (${config.overlap}) must be < size (${config.size})`
      );
    }
  }

  chunk(text: string, source: string): Chunk[] {
    if (text.length === 0) return [];

    const title = extractTitle(text);
    const { size, overlap } = this.config;
    const step = size - overlap;

    const chunks: Chunk[] = [];
    let index = 0;
    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + size, text.length);
      const slice = text.slice(start, end);
      chunks.push({
        strategy: "fixed",
        source,
        title,
        section: null,
        chunkIndex: index,
        charStart: start,
        charEnd: end,
        text: slice,
      });
      index += 1;
      if (end === text.length) break;
      start += step;
    }
    return chunks;
  }
}

function extractTitle(text: string): string | null {
  const match = text.match(TITLE_REGEX);
  return match ? match[1]!.trim() : null;
}
