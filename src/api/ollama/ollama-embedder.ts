import type { Embedder } from "../../domain/ports/embedder";

export type OllamaEmbedderConfig = {
  baseUrl: string;
  model: string;
  dimension: number;
};

type OllamaEmbedResponse = {
  model: string;
  embeddings: number[][];
};

export class OllamaEmbedder implements Embedder {
  readonly dimension: number;

  constructor(private readonly config: OllamaEmbedderConfig) {
    this.dimension = config.dimension;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];

    const url = `${this.config.baseUrl.replace(/\/$/, "")}/api/embed`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.config.model, input: texts }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Ollama embed failed: HTTP ${response.status} ${response.statusText}${body ? ` — ${body}` : ""}`
      );
    }

    const data = (await response.json()) as OllamaEmbedResponse;

    if (!Array.isArray(data.embeddings)) {
      throw new Error("Ollama embed response missing 'embeddings' array");
    }
    if (data.embeddings.length !== texts.length) {
      throw new Error(
        `Ollama embed returned ${data.embeddings.length} embeddings for ${texts.length} inputs`
      );
    }

    return data.embeddings.map((vec, i) => {
      if (!Array.isArray(vec) || vec.length !== this.dimension) {
        throw new Error(
          `Ollama embed vector ${i} has wrong dimension: expected ${this.dimension}, got ${Array.isArray(vec) ? vec.length : typeof vec}`
        );
      }
      return new Float32Array(vec);
    });
  }
}
