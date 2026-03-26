import type OpenAI from "openai";
import pc from "picocolors";

import type { AppConfig } from "./config";
import type { ChatMessage } from "./request";
import { buildResponseRequest } from "./request";
import { getMessages } from "./db";
import { buildContext } from "./context-builder";
import { calculateCost } from "./token-stats";

type BenchmarkResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  messageCount: number;
};

async function sendBenchmarkRequest(
  client: OpenAI,
  config: AppConfig,
  prompt: string,
  history: ChatMessage[]
): Promise<BenchmarkResult> {
  const configWithPrompt = { ...config, prompt };
  const request = buildResponseRequest(configWithPrompt, history);
  const response = await client.responses.create({ ...request, stream: false });

  const text = response.output_text ?? "";
  const inputTokens = response.usage?.input_tokens ?? 0;
  const outputTokens = response.usage?.output_tokens ?? 0;
  const pricing = { inputPricePerMillion: config.tokenPriceInput, outputPricePerMillion: config.tokenPriceOutput };

  return {
    text,
    inputTokens,
    outputTokens,
    cost: calculateCost({ inputTokens, outputTokens }, pricing),
    messageCount: history.length + 1 // history + текущий промпт
  };
}

function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph.length <= width) {
      lines.push(paragraph);
      continue;
    }
    let remaining = paragraph;
    while (remaining.length > width) {
      let breakAt = remaining.lastIndexOf(" ", width);
      if (breakAt <= 0) breakAt = width;
      lines.push(remaining.slice(0, breakAt));
      remaining = remaining.slice(breakAt).trimStart();
    }
    if (remaining) lines.push(remaining);
  }
  return lines;
}

function pad(str: string, width: number): string {
  return str.length >= width ? str.slice(0, width) : str + " ".repeat(width - str.length);
}

export function formatBenchmarkTable(
  compressed: BenchmarkResult,
  full: BenchmarkResult,
  summaryLabel: string
): string {
  const colWidth = 36;
  const totalWidth = colWidth * 2 + 3; // 2 cols + borders

  const hr = "─".repeat(colWidth);
  const lines: string[] = [];

  lines.push(`┌${hr}┬${hr}┐`);
  lines.push(`│${pad("  Со сжатием", colWidth)}│${pad("  Без сжатия", colWidth)}│`);
  lines.push(`├${hr}┼${hr}┤`);

  // Ответы
  const leftLines = wrapText(compressed.text, colWidth - 2);
  const rightLines = wrapText(full.text, colWidth - 2);
  const maxLines = Math.max(leftLines.length, rightLines.length);
  for (let i = 0; i < maxLines; i++) {
    const l = leftLines[i] ?? "";
    const r = rightLines[i] ?? "";
    lines.push(`│ ${pad(l, colWidth - 1)}│ ${pad(r, colWidth - 1)}│`);
  }

  lines.push(`├${hr}┼${hr}┤`);

  // Статистика
  const stats = [
    [`Tokens: ${compressed.inputTokens} in / ${compressed.outputTokens} out`, `Tokens: ${full.inputTokens} in / ${full.outputTokens} out`],
    [`Cost: $${compressed.cost.toFixed(4)}`, `Cost: $${full.cost.toFixed(4)}`],
    [`Messages: ${compressed.messageCount} ${summaryLabel}`, `Messages: ${full.messageCount}`]
  ];

  for (const [l, r] of stats) {
    lines.push(`│ ${pad(l, colWidth - 1)}│ ${pad(r, colWidth - 1)}│`);
  }

  lines.push(`└${hr}┴${hr}┘`);

  return lines.join("\n");
}

export async function runBenchmark(
  client: OpenAI,
  config: AppConfig,
  prompt: string,
  sessionId: number
): Promise<string> {
  // Собираем оба варианта контекста
  const [compressedCtx, fullHistory] = await Promise.all([
    buildContext(client, config.model, sessionId, config.contextTailSize),
    Promise.resolve(
      getMessages(sessionId).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content
      }))
    )
  ]);

  // Отправляем два запроса параллельно
  const [compressed, full] = await Promise.all([
    sendBenchmarkRequest(client, config, prompt, compressedCtx.messages),
    sendBenchmarkRequest(client, config, prompt, fullHistory)
  ]);

  const summaryLabel = compressedCtx.summaryUsed ? "+ summary" : "";
  return formatBenchmarkTable(compressed, full, summaryLabel);
}
