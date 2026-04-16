import type { VectorSearchHit } from "../models/chunking";
import type { Reranker, RankedHit } from "./rag-pipeline-service";

export type OllamaLlmConfig = {
  baseUrl: string;
  model: string;
};

type OllamaChatResponse = {
  message?: { content?: string };
};

const RERANK_PROMPT = `You are a relevance scoring system. Given a query and a text chunk, rate how relevant the chunk is to answering the query.

Output ONLY a single number between 0.0 and 1.0:
- 0.0 = completely irrelevant
- 0.5 = partially relevant
- 1.0 = highly relevant, directly answers the query

Output the number only, no explanation.`;

export class LlmRerankerService implements Reranker {
  constructor(
    private readonly config: OllamaLlmConfig,
    private readonly minRelevance: number = 0.3,
  ) {}

  async rerank(query: string, hits: VectorSearchHit[]): Promise<RankedHit[]> {
    const scored = await Promise.all(
      hits.map(async (hit) => {
        const score = await this.scoreRelevance(query, hit.text);
        return { ...hit, relevanceScore: score };
      }),
    );

    return scored
      .filter((h) => h.relevanceScore >= this.minRelevance)
      .sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  private async scoreRelevance(query: string, chunkText: string): Promise<number> {
    const userMessage = `Query: ${query}\n\nChunk:\n${chunkText.slice(0, 1500)}`;

    try {
      const url = `${this.config.baseUrl.replace(/\/$/, "")}/api/chat`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: "system", content: RERANK_PROMPT },
            { role: "user", content: userMessage },
          ],
          stream: false,
          options: { temperature: 0, num_predict: 10 },
        }),
      });

      if (!response.ok) {
        return 0;
      }

      const data = (await response.json()) as OllamaChatResponse;
      return parseRelevanceScore(data.message?.content ?? "");
    } catch {
      return 0;
    }
  }
}

export function parseRelevanceScore(raw: string): number {
  const match = raw.trim().match(/-?\d+\.?\d*/);
  if (!match) return 0;
  const parsed = parseFloat(match[0]);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(1, parsed));
}
