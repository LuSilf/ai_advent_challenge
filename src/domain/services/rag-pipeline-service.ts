import type { VectorSearchHit } from "../models/chunking";
import type { Embedder } from "../ports/embedder";
import type { VectorIndex } from "../ports/vector-index";
import { type RagRetrieveResult, type RagRetriever, buildRagPromptSuffix, buildCitedRagPromptSuffix } from "./rag-service";
import { filterByThreshold, type ThresholdFilterResult } from "./threshold-filter";

export type RagMode = {
  name: string;
  strategy: "fixed" | "structural";
  topKInitial: number;
  topKFinal: number;
  threshold?: number;
  reranker?: Reranker;
  queryRewriter?: QueryRewriter;
  useCitations?: boolean;
};

export interface Reranker {
  rerank(query: string, hits: VectorSearchHit[]): Promise<RankedHit[]>;
}

export type RankedHit = VectorSearchHit & {
  relevanceScore: number;
};

export interface QueryRewriter {
  rewrite(query: string): Promise<string>;
}

export type PipelineRetrieveResult = RagRetrieveResult & {
  modeName: string;
  rewrittenQuery?: string;
  hitsBeforeFilter: number;
  thresholdFilter?: ThresholdFilterResult;
  rerankedHits?: RankedHit[];
};

export class RagPipelineService implements RagRetriever {
  constructor(
    private readonly embedder: Embedder,
    private readonly vectorIndex: VectorIndex,
    private readonly mode: RagMode,
  ) {}

  async retrieve(question: string): Promise<PipelineRetrieveResult> {
    const { mode } = this;
    const totalChunks = this.vectorIndex.countByStrategy(mode.strategy);

    if (totalChunks === 0) {
      return {
        status: "no_index",
        strategy: mode.strategy,
        topK: mode.topKFinal,
        hits: [],
        modeName: mode.name,
        hitsBeforeFilter: 0,
      };
    }

    let searchQuery = question;
    let rewrittenQuery: string | undefined;

    if (mode.queryRewriter) {
      searchQuery = await mode.queryRewriter.rewrite(question);
      rewrittenQuery = searchQuery;
    }

    const vectors = await this.embedder.embed([searchQuery]);
    const queryVector = vectors[0];
    if (!queryVector) {
      return {
        status: "no_hits",
        strategy: mode.strategy,
        topK: mode.topKFinal,
        hits: [],
        modeName: mode.name,
        hitsBeforeFilter: 0,
        rewrittenQuery,
      };
    }

    let hits = this.vectorIndex.search(queryVector, mode.topKInitial, {
      strategy: mode.strategy,
    });

    if (hits.length === 0) {
      return {
        status: "no_hits",
        strategy: mode.strategy,
        topK: mode.topKFinal,
        hits,
        modeName: mode.name,
        hitsBeforeFilter: 0,
        rewrittenQuery,
      };
    }

    const hitsBeforeFilter = hits.length;
    let thresholdResult: ThresholdFilterResult | undefined;

    if (mode.threshold !== undefined) {
      thresholdResult = filterByThreshold(hits, mode.threshold);
      hits = thresholdResult.accepted;
    }

    let rerankedHits: RankedHit[] | undefined;

    if (mode.reranker && hits.length > 0) {
      rerankedHits = await mode.reranker.rerank(question, hits);
      hits = rerankedHits.slice(0, mode.topKFinal);
    } else {
      hits = hits.slice(0, mode.topKFinal);
    }

    if (hits.length === 0) {
      const hadHitsBeforeFiltering = hitsBeforeFilter > 0;
      return {
        status: hadHitsBeforeFiltering ? "insufficient_context" : "no_hits",
        strategy: mode.strategy,
        topK: mode.topKFinal,
        hits,
        modeName: mode.name,
        hitsBeforeFilter,
        rewrittenQuery,
        thresholdFilter: thresholdResult,
        rerankedHits,
      };
    }

    return {
      status: "ok",
      strategy: mode.strategy,
      topK: mode.topKFinal,
      hits,
      promptSuffix: mode.useCitations ? buildCitedRagPromptSuffix(hits) : buildRagPromptSuffix(hits),
      modeName: mode.name,
      hitsBeforeFilter,
      rewrittenQuery,
      thresholdFilter: thresholdResult,
      rerankedHits,
    };
  }
}
