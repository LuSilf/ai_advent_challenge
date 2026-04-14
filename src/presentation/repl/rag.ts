import type { ChunkStrategy } from "../../domain/models/chunking";
import type { RagRetrieveResult, RagRetriever } from "../../domain/services/rag-service";

export const DEFAULT_RAG_STRATEGY: ChunkStrategy = "structural";
export const DEFAULT_RAG_TOP_K = 5;

export type RagRuntimeState = {
  enabled: boolean;
  strategy: ChunkStrategy;
  topK: number;
  lastResult?: RagRetrieveResult;
};

export type PreparedRagPrompt = {
  userPromptSuffix?: string;
  retrieval?: RagRetrieveResult;
  notice?: string;
};

export async function prepareRagPrompt(
  question: string,
  state: RagRuntimeState,
  retriever?: RagRetriever,
  existingSuffix?: string,
): Promise<PreparedRagPrompt> {
  if (!state.enabled || !retriever) {
    return { userPromptSuffix: existingSuffix };
  }

  const retrieval = await retriever.retrieve(question, {
    strategy: state.strategy,
    topK: state.topK,
  });

  if (retrieval.status === "ok") {
    return {
      retrieval,
      userPromptSuffix: combineSuffixes(existingSuffix, retrieval.promptSuffix),
    };
  }

  if (retrieval.status === "no_index") {
    return {
      retrieval,
      userPromptSuffix: existingSuffix,
      notice: `[RAG] Индекс для стратегии ${state.strategy} не найден, отвечаю без RAG`,
    };
  }

  return {
    retrieval,
    userPromptSuffix: existingSuffix,
    notice: `[RAG] По запросу ничего не найдено, отвечаю без RAG`,
  };
}

function combineSuffixes(...parts: Array<string | undefined>): string | undefined {
  const normalized = parts.map((part) => part?.trim()).filter((part): part is string => Boolean(part));
  if (normalized.length === 0) return undefined;
  return normalized.join("\n\n");
}
