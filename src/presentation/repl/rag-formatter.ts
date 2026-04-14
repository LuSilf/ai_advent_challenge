import pc from "picocolors";

import type { RagRetrieveResult } from "../../domain/services/rag-service";

const SNIPPET_LENGTH = 120;

export function formatRagTechBlock(result: RagRetrieveResult): string {
  if (result.status === "no_index") {
    return [
      pc.dim("[RAG] retrieval unavailable"),
      pc.dim(`  Индекс для стратегии ${result.strategy} не найден. Ответ будет сгенерирован без RAG.`),
    ].join("\n");
  }

  if (result.status === "no_hits") {
    return [
      pc.dim("[RAG] retrieval empty"),
      pc.dim(`  По запросу ничего не найдено (strategy=${result.strategy}, topK=${result.topK}). Ответ будет сгенерирован без RAG.`),
    ].join("\n");
  }

  const lines = [
    pc.cyan(`[RAG] найдено ${result.hits.length} чанков (strategy=${result.strategy}, topK=${result.topK})`),
  ];

  for (let index = 0; index < result.hits.length; index++) {
    const hit = result.hits[index]!;
    const section = hit.section ?? "(без section)";
    const snippet = compactSnippet(hit.text);
    lines.push(`  ${index + 1}. ${hit.source} | ${section} | distance=${hit.distance.toFixed(4)}`);
    lines.push(pc.dim(`     ${snippet}`));
  }

  return lines.join("\n");
}

export function formatRagErrorBlock(message: string): string {
  return [
    pc.dim("[RAG] retrieval error"),
    pc.dim(`  ${message}. Ответ будет сгенерирован без RAG.`),
  ].join("\n");
}

function compactSnippet(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= SNIPPET_LENGTH) return normalized;
  return normalized.slice(0, SNIPPET_LENGTH) + "…";
}
