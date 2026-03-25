import pc from "picocolors";
import type { TokenUsageRow } from "./db";
import type { AppConfig } from "./config";

export function formatCost(cost: number): string {
  if (cost === 0) return "$0";
  if (cost < 0.0001) return `$${cost.toExponential(1)}`;
  return `$${cost.toFixed(4)}`;
}

export function formatCompactTokenLine(
  inputTokens: number,
  outputTokens: number,
  sessionTotalTokens: number,
  contextLength: number,
  sessionTotalCost: number,
): string {
  const pct = contextLength > 0 ? ((sessionTotalTokens / contextLength) * 100).toFixed(1) : "?";
  const contextStr = contextLength >= 1000 ? `${Math.round(contextLength / 1000)}k` : String(contextLength);

  return pc.dim(
    `[in:${inputTokens} out:${outputTokens} | контекст: ${sessionTotalTokens}/${contextStr} (${pct}%) | ${formatCost(sessionTotalCost)}]`
  );
}

export function formatTokenTable(rows: TokenUsageRow[], sessionId: number, contextLength: number): string {
  const lines: string[] = [];
  const exchangeCount = rows.length;

  lines.push(pc.bold(`📊 Статистика сессии #${sessionId} (${exchangeCount} обменов)`));
  lines.push("──────────────────────────────────────────────────────────────────");
  lines.push(
    pc.bold(
      padR("#", 5) + padR("Input", 9) + padR("Output", 9) + padR("Cached", 9) + padR("Reasoning", 11) + padR("Total", 9) + "Cost"
    )
  );

  let sumInput = 0, sumOutput = 0, sumCached = 0, sumReasoning = 0, sumTotal = 0, sumCost = 0;

  for (const row of rows) {
    sumInput += row.inputTokens;
    sumOutput += row.outputTokens;
    sumCached += row.cachedTokens;
    sumReasoning += row.reasoningTokens;
    sumTotal += row.totalTokens;
    sumCost += row.totalCost;

    lines.push(
      padR(String(row.exchangeNum), 5) +
      padR(String(row.inputTokens), 9) +
      padR(String(row.outputTokens), 9) +
      padR(String(row.cachedTokens), 9) +
      padR(String(row.reasoningTokens), 11) +
      padR(String(row.totalTokens), 9) +
      formatCost(row.totalCost)
    );
  }

  lines.push("──────────────────────────────────────────────────────────────────");

  const pct = contextLength > 0 ? ((sumTotal / contextLength) * 100).toFixed(1) : "?";

  lines.push(
    pc.bold(
      padR("Всего:", 5) +
      padR(String(sumInput), 9) +
      padR(String(sumOutput), 9) +
      padR(String(sumCached), 9) +
      padR(String(sumReasoning), 11) +
      padR(String(sumTotal), 9) +
      formatCost(sumCost)
    )
  );
  lines.push(`Контекст: ${sumTotal} / ${contextLength} (${pct}%)`);

  return lines.join("\n");
}

export function formatModelInfo(config: AppConfig): string {
  const raw = config.modelRaw;
  const lines: string[] = [];

  if (!raw) {
    lines.push(pc.dim("Данные модели из API недоступны (используются значения из конфига)"));
    lines.push(`  Модель:      ${config.model}`);
    lines.push(`  Контекст:    ${config.contextLength.toLocaleString()} токенов`);
    lines.push(`  Цена input:  ${formatPricePerMillion(config.inputPrice)}`);
    lines.push(`  Цена output: ${formatPricePerMillion(config.outputPrice)}`);
    return lines.join("\n");
  }

  const contextStr = raw.context_length
    ? `${(raw.context_length / 1000).toFixed(0)}k (${raw.context_length.toLocaleString()})`
    : "н/д";

  lines.push(pc.bold("🤖 Информация о модели (из API)"));
  lines.push("──────────────────────────────────────────");
  lines.push(`  ID:              ${pc.cyan(raw.id)}`);
  if (raw.name) {
    lines.push(`  Название:        ${raw.name}`);
  }
  lines.push(`  Контекст:        ${contextStr} токенов`);

  if (raw.top_provider?.max_completion_tokens) {
    lines.push(`  Макс. ответ:     ${raw.top_provider.max_completion_tokens.toLocaleString()} токенов`);
  }

  if (raw.pricing) {
    lines.push(`  Цена input:      ${formatPricePerMillion(Number(raw.pricing.prompt ?? 0))}`);
    lines.push(`  Цена output:     ${formatPricePerMillion(Number(raw.pricing.completion ?? 0))}`);
    if (raw.pricing.image && raw.pricing.image !== "0") {
      lines.push(`  Цена image:      $${Number(raw.pricing.image).toFixed(4)} / шт`);
    }
  }

  if (raw.architecture) {
    if (raw.architecture.modality) {
      lines.push(`  Модальность:     ${raw.architecture.modality}`);
    }
    if (raw.architecture.tokenizer) {
      lines.push(`  Токенизатор:     ${raw.architecture.tokenizer}`);
    }
    if (raw.architecture.instruct_type) {
      lines.push(`  Тип инструкций:  ${raw.architecture.instruct_type}`);
    }
  }

  if (raw.top_provider?.is_moderated !== undefined) {
    lines.push(`  Модерация:       ${raw.top_provider.is_moderated ? "да" : "нет"}`);
  }

  lines.push("──────────────────────────────────────────");

  return lines.join("\n");
}

function formatPricePerMillion(pricePerToken: number): string {
  if (pricePerToken === 0) return "$0";
  const perMillion = pricePerToken * 1_000_000;
  return `$${perMillion.toFixed(2)} / 1M токенов`;
}

function padR(str: string, len: number): string {
  return str.length >= len ? str : str + " ".repeat(len - str.length);
}
