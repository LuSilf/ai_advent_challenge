import type { OptionsRepository } from "./domain/ports/options-repository";

export const DEFAULT_INDEXING_CONFIG = {
  fixedSize: 1500,
  fixedOverlap: 200,
  structuralPrimaryLevel: 2,
  structuralSplitLevel: 3,
  structuralMaxSize: 2000,
  embeddingProvider: "ollama",
  embeddingModel: "nomic-embed-text",
  embeddingBaseUrl: "http://localhost:11434",
  embeddingDim: 768,
} as const;

export type IndexingConfig = {
  fixedSize: number;
  fixedOverlap: number;
  structuralPrimaryLevel: number;
  structuralSplitLevel: number;
  structuralMaxSize: number;
  embeddingProvider: string;
  embeddingModel: string;
  embeddingBaseUrl: string;
  embeddingDim: number;
};

export function readIndexingConfig(options: OptionsRepository): IndexingConfig {
  const getInt = (key: string, fallback: number): number => {
    const raw = options.get(key);
    if (raw === null || raw === "") return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const getStr = (key: string, fallback: string): string => {
    const raw = options.get(key);
    return raw && raw.length > 0 ? raw : fallback;
  };
  return {
    fixedSize: getInt("indexing.chunk.fixed.size", DEFAULT_INDEXING_CONFIG.fixedSize),
    fixedOverlap: getInt("indexing.chunk.fixed.overlap", DEFAULT_INDEXING_CONFIG.fixedOverlap),
    structuralPrimaryLevel: getInt("indexing.chunk.structural.primaryLevel", DEFAULT_INDEXING_CONFIG.structuralPrimaryLevel),
    structuralSplitLevel: getInt("indexing.chunk.structural.splitLevel", DEFAULT_INDEXING_CONFIG.structuralSplitLevel),
    structuralMaxSize: getInt("indexing.chunk.structural.maxSize", DEFAULT_INDEXING_CONFIG.structuralMaxSize),
    embeddingProvider: getStr("indexing.embeddings.provider", DEFAULT_INDEXING_CONFIG.embeddingProvider),
    embeddingModel: getStr("indexing.embeddings.model", DEFAULT_INDEXING_CONFIG.embeddingModel),
    embeddingBaseUrl: getStr("indexing.embeddings.baseUrl", DEFAULT_INDEXING_CONFIG.embeddingBaseUrl),
    embeddingDim: getInt("indexing.embeddings.dim", DEFAULT_INDEXING_CONFIG.embeddingDim),
  };
}
