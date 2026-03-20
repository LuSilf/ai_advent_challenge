import OpenAI from "openai";
import type { Response } from "openai/resources/responses/responses";
import pc from "picocolors";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PROMPT = (
  process.env.BENCH_PROMPT ??
  "Напиши на языке Gleam рекурсивную функцию flatten, которая превращает вложенный список в плоский. Покажи пример вызова. Не используй стандартную библиотеку gleam/list."
).trim();

const SYSTEM_PROMPT =
  "Ты — опытный программист. Пиши только код на языке Gleam с краткими комментариями. Не путай Gleam с Elixir, Erlang или Rust.";

type ModelTier = {
  tier: string;
  model: string;
  inputPricePer1M: number;
  outputPricePer1M: number;
  reasoning?: boolean;
};

// Три тира: слабые, средние, сильные
// Микс reasoning и обычных моделей, цены OpenRouter (март 2026)
const TIERS: ModelTier[] = JSON.parse(
  process.env.BENCH_MODELS ??
    JSON.stringify([
      // ── Слабые (дешёвые, быстрые) ──
      {
        tier: "🟢 weak",
        model: "qwen/qwen3.5-9b",
        inputPricePer1M: 0.05,
        outputPricePer1M: 0.15
      },
      {
        tier: "🟢 weak",
        model: "meta-llama/llama-4-scout",
        inputPricePer1M: 0.08,
        outputPricePer1M: 0.3
      },
      {
        tier: "🟢 weak",
        model: "openai/gpt-5.4-mini",
        inputPricePer1M: 0.75,
        outputPricePer1M: 4.5
      },

      // ── Средние ──
      {
        tier: "🟡 medium",
        model: "gpt-4.1",
        inputPricePer1M: 2.0,
        outputPricePer1M: 8.0
      },
      {
        tier: "🟡 medium",
        model: "openai/gpt-5.2",
        inputPricePer1M: 1.75,
        outputPricePer1M: 14.0
      },
      {
        tier: "🟡 medium",
        model: "anthropic/claude-sonnet-4",
        inputPricePer1M: 3.0,
        outputPricePer1M: 15.0
      },

      // ── Сильные (дорогие, reasoning) ──
      {
        tier: "🔴 strong",
        model: "openai/gpt-5.4",
        inputPricePer1M: 2.5,
        outputPricePer1M: 15.0
      },
      {
        tier: "🔴 strong",
        model: "google/gemini-2.5-pro-preview",
        inputPricePer1M: 1.25,
        outputPricePer1M: 10.0,
        reasoning: true
      },
      {
        tier: "🔴 strong",
        model: "anthropic/claude-opus-4",
        inputPricePer1M: 15.0,
        outputPricePer1M: 75.0
      }
    ])
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getApiKey(): string {
  const envName = process.env.OPENAI_API_KEY_ENV;
  const key = process.env.OPENAI_API_KEY ?? (envName ? process.env[envName] : undefined);
  if (!key) {
    console.error("Missing OPENAI_API_KEY");
    process.exit(1);
  }
  return key;
}

function costUsd(tier: ModelTier, inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * tier.inputPricePer1M + (outputTokens / 1_000_000) * tier.outputPricePer1M;
}

function pad(s: string, n: number): string {
  return s.padEnd(n);
}

function rpad(s: string, n: number): string {
  return s.padStart(n);
}

// ---------------------------------------------------------------------------
// Run one model
// ---------------------------------------------------------------------------

type RunResult = {
  tier: ModelTier;
  response: Response;
  wallMs: number;
  outputText: string;
};

async function runModel(client: OpenAI, tier: ModelTier): Promise<RunResult> {
  const start = Date.now();

  const request: Record<string, unknown> = {
    model: tier.model,
    instructions: SYSTEM_PROMPT,
    input: PROMPT,
    stream: false
  };

  // Для reasoning моделей добавим настройки
  if (tier.reasoning) {
    request.reasoning = { effort: "low", summary: "auto" };
  }

  const response = await client.responses.create(request as Parameters<typeof client.responses.create>[0]);

  const wallMs = Date.now() - start;
  const outputText = response.output_text ?? "";

  return { tier, response, wallMs, outputText };
}

// ---------------------------------------------------------------------------
// Pretty print
// ---------------------------------------------------------------------------

function printResults(results: RunResult[]): void {
  const sep = "─".repeat(90);

  console.log();
  console.log(pc.bold(pc.cyan("═══════════════════════════════════════════════════════════════════════")));
  console.log(pc.bold(pc.cyan("  День 5 · Сравнение моделей (OpenRouter)")));
  console.log(pc.bold(pc.cyan("═══════════════════════════════════════════════════════════════════════")));

  console.log();
  console.log(pc.bold("Промпт: ") + pc.dim(PROMPT));
  console.log();

  // ── Группируем по тирам ─────────────────────────────────────────
  const tierOrder = ["🟢 weak", "🟡 medium", "🔴 strong"];

  for (const tierName of tierOrder) {
    const tierResults = results.filter((r) => r.tier.tier === tierName);
    if (tierResults.length === 0) continue;

    console.log(pc.bold(pc.yellow(`\n── ${tierName.toUpperCase()} ──`)));

    for (const r of tierResults) {
      console.log();
      console.log(pc.bold(`  ${r.tier.model}`));
      console.log(pc.dim(`  ${sep.slice(0, 70)}`));
      // Indent response text
      const lines = r.outputText.split("\n");
      for (const line of lines) {
        console.log(`  ${line}`);
      }
      console.log(pc.dim(`  ${sep.slice(0, 70)}`));
    }
  }

  console.log();

  // ── Таблица метрик ─────────────────────────────────────────────
  console.log(pc.bold(pc.magenta("═══ Метрики ═══")));
  console.log();

  const header = [
    pad("Тир", 12),
    pad("Модель", 38),
    rpad("Время", 7),
    rpad("In", 6),
    rpad("Out", 6),
    rpad("Reas", 6),
    rpad("tok/s", 7),
    rpad("Цена $", 10)
  ].join(" │ ");

  console.log(pc.bold(header));
  console.log("─".repeat(header.length));

  for (const r of results) {
    const u = r.response.usage;
    const inputTok = u?.input_tokens ?? 0;
    const outputTok = u?.output_tokens ?? 0;
    const reasonTok = u?.output_tokens_details?.reasoning_tokens ?? 0;
    const tps = r.wallMs > 0 ? outputTok / (r.wallMs / 1000) : 0;
    const cost = costUsd(r.tier, inputTok, outputTok);

    const row = [
      pad(r.tier.tier, 12),
      pad(r.tier.model, 38),
      rpad(`${(r.wallMs / 1000).toFixed(1)}s`, 7),
      rpad(String(inputTok), 6),
      rpad(String(outputTok), 6),
      rpad(String(reasonTok), 6),
      rpad(`${tps.toFixed(0)}`, 7),
      rpad(`$${cost.toFixed(6)}`, 10)
    ].join(" │ ");

    console.log(row);
  }

  console.log();

  // ── Аналитика ──────────────────────────────────────────────────
  console.log(pc.bold(pc.cyan("═══ Выводы ═══")));
  console.log();

  const fastest = results.reduce((a, b) => (a.wallMs < b.wallMs ? a : b));
  const slowest = results.reduce((a, b) => (a.wallMs > b.wallMs ? a : b));

  const withCost = results.map((r) => ({
    r,
    cost: costUsd(r.tier, r.response.usage?.input_tokens ?? 0, r.response.usage?.output_tokens ?? 0)
  }));
  const paidOnly = withCost.filter((x) => x.cost > 0);
  const cheapest = paidOnly.length > 0 ? paidOnly.reduce((a, b) => (a.cost < b.cost ? a : b)) : null;
  const mostExpensive = paidOnly.length > 0 ? paidOnly.reduce((a, b) => (a.cost > b.cost ? a : b)) : null;

  const highestTps = results.reduce((a, b) => {
    const aTps = (a.response.usage?.output_tokens ?? 0) / (a.wallMs / 1000);
    const bTps = (b.response.usage?.output_tokens ?? 0) / (b.wallMs / 1000);
    return aTps > bTps ? a : b;
  });

  console.log(`  ⚡ Быстрее всех: ${fastest.tier.model} (${(fastest.wallMs / 1000).toFixed(1)}s)`);
  console.log(`  🐢 Медленнее всех: ${slowest.tier.model} (${(slowest.wallMs / 1000).toFixed(1)}s)`);
  console.log(`  🚀 Макс. throughput: ${highestTps.tier.model} (${((highestTps.response.usage?.output_tokens ?? 0) / (highestTps.wallMs / 1000)).toFixed(0)} tok/s)`);

  if (cheapest) {
    console.log(`  💰 Дешевле всех (платные): ${cheapest.r.tier.model} ($${cheapest.cost.toFixed(6)})`);
  }
  if (mostExpensive) {
    console.log(`  💸 Дороже всех: ${mostExpensive.r.tier.model} ($${mostExpensive.cost.toFixed(6)})`);
  }

  if (mostExpensive && cheapest && cheapest.cost > 0) {
    console.log(`  📊 Разброс по цене: ${(mostExpensive.cost / cheapest.cost).toFixed(0)}x`);
  }

  console.log(`  ⏱  Разброс по времени: ${(slowest.wallMs / fastest.wallMs).toFixed(1)}x`);

  // Free models
  const freeModels = withCost.filter((x) => x.cost === 0);
  if (freeModels.length > 0) {
    console.log(`  🆓 Бесплатные: ${freeModels.map((x) => x.r.tier.model).join(", ")}`);
  }

  console.log();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS ?? "120000");

  const client = new OpenAI({
    apiKey: getApiKey(),
    baseURL: baseUrl,
    timeout: timeoutMs,
    maxRetries: 0
  });

  console.log(pc.dim(`Endpoint: ${baseUrl}`));
  console.log(pc.dim(`Модели (${TIERS.length}): ${TIERS.map((t) => t.model).join(", ")}`));
  console.log(pc.dim("Запускаем бенчмарк…\n"));

  const results: RunResult[] = [];

  for (const tier of TIERS) {
    process.stderr.write(pc.dim(`  ⏳ ${tier.model}… `));
    try {
      const result = await runModel(client, tier);
      process.stderr.write(pc.green(`✓ ${(result.wallMs / 1000).toFixed(1)}s\n`));
      results.push(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(pc.red(`✗ ${msg.slice(0, 120)}\n`));
    }
  }

  if (results.length === 0) {
    console.error("Все модели вернули ошибку.");
    process.exit(1);
  }

  printResults(results);
}

main();
