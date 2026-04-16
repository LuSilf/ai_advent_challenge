import type { QueryRewriter } from "./rag-pipeline-service";

export type OllamaLlmConfig = {
  baseUrl: string;
  model: string;
};

type OllamaChatResponse = {
  message?: { content?: string };
};

const REWRITE_PROMPT = `You are a query reformulation system for a technical knowledge base about system design.

Given a user's question, rewrite it to improve retrieval from a vector search index:
1. Expand abbreviations and add synonyms
2. Add relevant technical terms that might appear in the documents
3. Remove conversational language, keep it factual
4. Keep the original intent intact

Output ONLY the rewritten query, nothing else. Keep it concise (1-3 sentences max).`;

export class QueryRewriteService implements QueryRewriter {
  constructor(private readonly config: OllamaLlmConfig) {}

  async rewrite(query: string): Promise<string> {
    try {
      const url = `${this.config.baseUrl.replace(/\/$/, "")}/api/chat`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: "system", content: REWRITE_PROMPT },
            { role: "user", content: query },
          ],
          stream: false,
          options: { temperature: 0.3, num_predict: 200 },
        }),
      });

      if (!response.ok) {
        return query;
      }

      const data = (await response.json()) as OllamaChatResponse;
      const rewritten = data.message?.content?.trim();

      if (!rewritten || rewritten.length < 5) {
        return query;
      }

      return rewritten;
    } catch {
      return query;
    }
  }
}
