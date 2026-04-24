import type { PipelineRetrieveResult } from "./rag-pipeline-service";

export type RefusalReason = "no_hits" | "below_threshold" | "insufficient_context";

export type RefusalDecision = {
  shouldRefuse: boolean;
  reason: RefusalReason | null;
  maxRelevanceScore: number | null;
};

export class RetrievalRefusalPolicy {
  constructor(private readonly relevanceThreshold: number) {}

  decide(retrieval: PipelineRetrieveResult): RefusalDecision {
    if (retrieval.status === "no_hits") {
      return { shouldRefuse: true, reason: "no_hits", maxRelevanceScore: null };
    }
    if (retrieval.status === "insufficient_context") {
      return { shouldRefuse: true, reason: "insufficient_context", maxRelevanceScore: null };
    }
    if (retrieval.status !== "ok") {
      return { shouldRefuse: true, reason: "below_threshold", maxRelevanceScore: null };
    }

    const reranked = retrieval.rerankedHits;
    if (!reranked || reranked.length === 0) {
      return { shouldRefuse: true, reason: "below_threshold", maxRelevanceScore: null };
    }

    const maxScore = reranked.reduce((max, h) => (h.relevanceScore > max ? h.relevanceScore : max), -Infinity);
    const maxRelevanceScore = Number.isFinite(maxScore) ? maxScore : null;

    if (maxScore < this.relevanceThreshold) {
      return { shouldRefuse: true, reason: "below_threshold", maxRelevanceScore };
    }

    return { shouldRefuse: false, reason: null, maxRelevanceScore };
  }
}
