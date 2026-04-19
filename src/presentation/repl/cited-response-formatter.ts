import pc from "picocolors";
import type { CitedRagResponse } from "../../domain/models/cited-rag-response";

export function formatCitedRagResponse(response: CitedRagResponse): string {
  const lines: string[] = [];

  if (response.confidence === "insufficient") {
    lines.push(pc.yellow("⚠ Недостаточно контекста"));
    lines.push("");
    lines.push(response.answer);
    return lines.join("\n");
  }

  lines.push(response.answer);

  if (response.sources.length > 0) {
    lines.push("");
    lines.push(pc.cyan("Источники:"));
    for (const src of response.sources) {
      const section = src.section ? ` > ${src.section}` : "";
      lines.push(`  ${src.sourceIndex}. ${src.source}${section}`);
    }
  }

  if (response.quotes.length > 0) {
    lines.push("");
    lines.push(pc.cyan("Цитаты:"));
    for (const quote of response.quotes) {
      lines.push(`  [${quote.sourceIndex}] ${pc.dim('"')}${quote.text}${pc.dim('"')}`);
    }
  }

  if (response.confidence === "low") {
    lines.push("");
    lines.push(pc.yellow("⚠ Ответ частично подкреплён источниками"));
  }

  return lines.join("\n");
}
