import type { ChunkStrategy } from "../../domain/models/chunking";
import type { OptionsRepository } from "../../domain/ports/options-repository";
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

export function readRagState(optionsRepo: OptionsRepository): RagRuntimeState {
  const enabled = parseBooleanOption(optionsRepo.get("rag_enabled"), false);
  const strategy = parseStrategyOption(optionsRepo.get("rag_strategy")) ?? DEFAULT_RAG_STRATEGY;
  const topK = parsePositiveIntegerOption(optionsRepo.get("rag_top_k")) ?? DEFAULT_RAG_TOP_K;

  return {
    enabled,
    strategy,
    topK,
  };
}

export function persistRagState(optionsRepo: OptionsRepository, state: RagRuntimeState): void {
  optionsRepo.set("rag_enabled", state.enabled ? "true" : "false");
  optionsRepo.set("rag_strategy", state.strategy);
  optionsRepo.set("rag_top_k", String(state.topK));
}

export function formatRagStatusLine(state: RagRuntimeState): string {
  return `RAG: ${state.enabled ? "on" : "off"} | strategy: ${state.strategy} | topK: ${state.topK}`;
}

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

function parseBooleanOption(raw: string | null, fallback: boolean): boolean {
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parseStrategyOption(raw: string | null): ChunkStrategy | null {
  if (raw === "fixed" || raw === "structural") return raw;
  return null;
}

function parsePositiveIntegerOption(raw: string | null): number | null {
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
}
