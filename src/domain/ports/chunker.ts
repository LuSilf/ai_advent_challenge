import type { Chunk } from "../models/chunking";

export interface Chunker {
  chunk(text: string, source: string): Chunk[];
}
