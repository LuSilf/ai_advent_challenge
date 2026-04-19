import type { ChunkStrategy, VectorSearchHit } from "../models/chunking";
import type { Embedder } from "../ports/embedder";
import type { VectorIndex } from "../ports/vector-index";

export type RagQueryOptions = {
  strategy: ChunkStrategy;
  topK: number;
};

export type RagRetrieveStatus = "ok" | "no_index" | "no_hits" | "insufficient_context";

export type RagRetrieveResult = {
  status: RagRetrieveStatus;
  strategy: ChunkStrategy;
  topK: number;
  hits: VectorSearchHit[];
  promptSuffix?: string;
};

export interface RagRetriever {
  retrieve(question: string, options: RagQueryOptions): Promise<RagRetrieveResult>;
}

export class RagService implements RagRetriever {
  constructor(
    private readonly embedder: Embedder,
    private readonly vectorIndex: VectorIndex,
  ) {}

  async retrieve(question: string, options: RagQueryOptions): Promise<RagRetrieveResult> {
    const totalChunks = this.vectorIndex.countByStrategy(options.strategy);
    if (totalChunks === 0) {
      return {
        status: "no_index",
        strategy: options.strategy,
        topK: options.topK,
        hits: [],
      };
    }

    const vectors = await this.embedder.embed([question]);
    const queryVector = vectors[0];
    if (!queryVector) {
      return {
        status: "no_hits",
        strategy: options.strategy,
        topK: options.topK,
        hits: [],
      };
    }

    const hits = this.vectorIndex.search(queryVector, options.topK, {
      strategy: options.strategy,
    });

    if (hits.length === 0) {
      return {
        status: "no_hits",
        strategy: options.strategy,
        topK: options.topK,
        hits,
      };
    }

    return {
      status: "ok",
      strategy: options.strategy,
      topK: options.topK,
      hits,
      promptSuffix: buildRagPromptSuffix(hits),
    };
  }
}

export function buildRagPromptSuffix(hits: VectorSearchHit[]): string {
  const sources = hits.map((hit, index) => {
    const sourceMeta = [
      `source=${hit.source}`,
      `section=${hit.section ?? "(none)"}`,
      `distance=${hit.distance.toFixed(4)}`,
    ].join(" | ");

    return [`[Источник ${index + 1}] ${sourceMeta}`, hit.text.trim()].join("\n");
  });

  return [
    "Используй найденные материалы как контекст, если они релевантны вопросу.",
    "Если в найденных материалах ответа нет, честно скажи об ограниченности базы и не выдумывай источник.",
    "",
    "Найденные материалы:",
    ...sources,
  ].join("\n\n");
}

export function buildCitedRagPromptSuffix(hits: VectorSearchHit[]): string {
  const sources = hits.map((hit, index) => {
    const sourceMeta = [
      `source=${hit.source}`,
      `section=${hit.section ?? "(none)"}`,
      `distance=${hit.distance.toFixed(4)}`,
    ].join(" | ");

    return [`[Источник ${index + 1}] ${sourceMeta}`, hit.text.trim()].join("\n");
  });

  return [
    "Ты — ассистент на основе базы знаний. Твой ответ ОБЯЗАН быть структурированным JSON.",
    "",
    "ПРАВИЛА:",
    "1. Отвечай ТОЛЬКО на основе найденных материалов ниже. НЕ используй свои знания.",
    "2. В поле sources — перечисли ВСЕ использованные источники с их sourceIndex, source и section.",
    "3. В поле quotes — приведи ДОСЛОВНЫЕ цитаты из найденных материалов, подтверждающие твой ответ. Цитируй точно, не перефразируй.",
    "4. Каждое утверждение в answer должно быть подкреплено хотя бы одной цитатой в quotes.",
    "5. Поле confidence:",
    "   - \"high\" — ответ полностью подкреплён найденными материалами",
    "   - \"low\" — ответ частично подкреплён, есть пробелы",
    "   - \"insufficient\" — найденные материалы НЕ содержат ответа на вопрос. В этом случае в answer напиши: \"К сожалению, в доступной базе знаний нет информации для ответа на этот вопрос. Попробуйте переформулировать запрос или уточнить тему.\"",
    "6. Если ни один источник не релевантен вопросу — ставь confidence=\"insufficient\", sources=[], quotes=[].",
    "",
    "Найденные материалы:",
    ...sources,
  ].join("\n");
}
