import type { CitedRagResponse } from "../models/cited-rag-response";

export type CitationScore = {
  hasSources: boolean;
  hasQuotes: boolean;
  sourceCount: number;
  quoteCount: number;
  confidence: CitedRagResponse["confidence"];
  isInsufficientCorrect?: boolean;
};

export function scoreCitation(
  response: CitedRagResponse | null,
  outOfScope: boolean,
): CitationScore {
  if (!response) {
    return {
      hasSources: false,
      hasQuotes: false,
      sourceCount: 0,
      quoteCount: 0,
      confidence: "insufficient",
    };
  }

  const score: CitationScore = {
    hasSources: response.sources.length > 0,
    hasQuotes: response.quotes.length > 0,
    sourceCount: response.sources.length,
    quoteCount: response.quotes.length,
    confidence: response.confidence,
  };

  if (outOfScope) {
    score.isInsufficientCorrect = response.confidence === "insufficient";
  }

  return score;
}
