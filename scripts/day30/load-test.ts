// Day 30 — load-test для приватного HTTP-сервиса локальной LLM.
// Прогоняет 6 сценариев: smoke, concurrency ladder, rate-limit hit,
// max-context reject, bad auth, bad model. Пишет report.md и raw JSON.

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const BASE_URL = process.env.LOADTEST_BASE_URL ?? "http://localhost:8080";
const API_KEY = process.env.LOADTEST_API_KEY ?? deriveFirstKey() ?? "sk-changeme";
const MODEL = process.env.LOADTEST_MODEL ?? "llama3.2:3b";
const CONCURRENCY_LEVELS = (process.env.LOADTEST_LEVELS ?? "1,2,5,10").split(",").map((s) => Number(s.trim()));
const COOLDOWN_BEFORE_LADDER_SEC = Number(process.env.LOADTEST_COOLDOWN_SEC ?? "15");
const RATE_LIMIT_BURST_SIZE = Number(process.env.LOADTEST_RATE_BURST ?? "15");

const RUN_TS = new Date().toISOString().replace(/[:.]/g, "-");
const SCRIPT_DIR = resolve(import.meta.dir);
const RAW_DIR = resolve(SCRIPT_DIR, "raw");
const REPORT_PATH = resolve(SCRIPT_DIR, "report.md");
const RAW_PATH = resolve(RAW_DIR, `load-test-${RUN_TS}.json`);

mkdirSync(RAW_DIR, { recursive: true });

type ChatResult = {
  status: number;
  latencyMs: number;
  body: unknown;
};

async function chat(payload: object, headers: Record<string, string> = {}, timeoutMs = 60_000): Promise<ChatResult> {
  const start = performance.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
        ...headers,
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const latencyMs = performance.now() - start;
    let body: unknown = null;
    try {
      body = await r.json();
    } catch {
      body = null;
    }
    return { status: r.status, latencyMs, body };
  } catch (err) {
    const latencyMs = performance.now() - start;
    return {
      status: 0,
      latencyMs,
      body: { error: { message: err instanceof Error ? err.message : String(err) } },
    };
  } finally {
    clearTimeout(timer);
  }
}

function percentile(arr: number[], p: number): number | null {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, idx)]);
}

function mean(arr: number[]): number | null {
  if (arr.length === 0) return null;
  return Math.round(arr.reduce((s, x) => s + x, 0) / arr.length);
}

async function sleep(seconds: number) {
  if (seconds <= 0) return;
  await new Promise((r) => setTimeout(r, seconds * 1000));
}

function deriveFirstKey(): string | null {
  const keys = process.env.LLM_SERVICE_API_KEYS;
  if (!keys) return null;
  const first = keys.split(",").find((s) => s.trim().length > 0);
  if (!first) return null;
  const colon = first.indexOf(":");
  return colon >= 0 ? first.slice(colon + 1).trim() : null;
}

async function checkServiceUp(): Promise<{ ok: boolean; ollama: string }> {
  try {
    const r = await fetch(`${BASE_URL}/health`);
    if (!r.ok) return { ok: false, ollama: "down" };
    const j = (await r.json()) as { ollama?: string };
    return { ok: true, ollama: j.ollama ?? "unknown" };
  } catch {
    return { ok: false, ollama: "unreachable" };
  }
}

function tryHardwareSnapshot(): string | null {
  try {
    const out = spawnSync("llmfit", ["system", "--json"], { encoding: "utf8" });
    if (out.status === 0 && out.stdout) {
      const j = JSON.parse(out.stdout);
      const cpu = j.cpu?.model ?? "unknown CPU";
      const ram = j.memory?.total_gb != null ? `${j.memory.total_gb} GB RAM` : "unknown RAM";
      const gpu = j.gpu?.[0]?.name ? `${j.gpu[0].name} ${j.gpu[0].vram_gb ?? "?"} GB VRAM` : "no GPU";
      return `CPU: ${cpu} | ${ram} | GPU: ${gpu}`;
    }
  } catch {}
  return null;
}

type LadderResult = {
  n: number;
  latencies: number[];
  okCount: number;
  errorCount: number;
  errorStatuses: number[];
  totalMs: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  mean: number | null;
};

async function scenarioConcurrencyLadder(levels: number[]): Promise<LadderResult[]> {
  const out: LadderResult[] = [];
  for (const n of levels) {
    console.log(`[ladder] N=${n}: cooldown ${COOLDOWN_BEFORE_LADDER_SEC}s, then ${n} parallel…`);
    await sleep(COOLDOWN_BEFORE_LADDER_SEC);
    const start = performance.now();
    const promises = Array.from({ length: n }, () =>
      chat({
        model: MODEL,
        messages: [{ role: "user", content: "Reply with the single word 'OK' and nothing else." }],
        max_tokens: 16,
      }),
    );
    const results = await Promise.all(promises);
    const totalMs = performance.now() - start;
    const oks = results.filter((r) => r.status === 200);
    const errs = results.filter((r) => r.status !== 200);
    const latencies = oks.map((r) => r.latencyMs);
    out.push({
      n,
      latencies: latencies.map((x) => Math.round(x)),
      okCount: oks.length,
      errorCount: errs.length,
      errorStatuses: errs.map((e) => e.status),
      totalMs: Math.round(totalMs),
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      mean: mean(latencies),
    });
  }
  return out;
}

async function scenarioRateLimitHit(): Promise<{
  pass: boolean;
  total: number;
  status200: number;
  status429: number;
  statuses: number[];
}> {
  console.log(`[rate-limit] sending ${RATE_LIMIT_BURST_SIZE} parallel requests on one key…`);
  await sleep(COOLDOWN_BEFORE_LADDER_SEC);
  const results = await Promise.all(
    Array.from({ length: RATE_LIMIT_BURST_SIZE }, () =>
      chat({
        model: MODEL,
        messages: [{ role: "user", content: "Reply with single word 'OK'." }],
        max_tokens: 8,
      }),
    ),
  );
  const statuses = results.map((r) => r.status);
  const status200 = statuses.filter((s) => s === 200).length;
  const status429 = statuses.filter((s) => s === 429).length;
  return { pass: status429 >= 1, total: results.length, status200, status429, statuses };
}

async function scenarioMaxContext(): Promise<{ pass: boolean; status: number; body: unknown }> {
  console.log("[max-context] sending oversized request…");
  await sleep(2);
  const big = "x ".repeat(20_000);
  const r = await chat({
    model: MODEL,
    messages: [{ role: "user", content: big }],
  });
  return { pass: r.status === 413, status: r.status, body: r.body };
}

async function scenarioBadAuth(): Promise<{ pass: boolean; status: number; body: unknown }> {
  console.log("[bad-auth] sending request without API key…");
  const r = await chat(
    { model: MODEL, messages: [{ role: "user", content: "ok" }] },
    { Authorization: "Bearer this-is-not-a-valid-key" },
  );
  return { pass: r.status === 401, status: r.status, body: r.body };
}

async function scenarioBadModel(): Promise<{ pass: boolean; status: number; body: unknown }> {
  console.log("[bad-model] sending request with model not in allowlist…");
  await sleep(2);
  const r = await chat({
    model: "definitely-not-a-real-model:0.0",
    messages: [{ role: "user", content: "ok" }],
  });
  return { pass: r.status === 400, status: r.status, body: r.body };
}

async function scenarioSmoke(): Promise<{ pass: boolean; status: number; latencyMs: number }> {
  console.log("[smoke] one valid request…");
  const r = await chat({
    model: MODEL,
    messages: [{ role: "user", content: "Reply with single word 'OK'." }],
    max_tokens: 8,
  });
  return { pass: r.status === 200, status: r.status, latencyMs: Math.round(r.latencyMs) };
}

function renderReport(payload: {
  generatedAt: string;
  baseUrl: string;
  model: string;
  hardware: string | null;
  health: { ok: boolean; ollama: string };
  smoke: Awaited<ReturnType<typeof scenarioSmoke>>;
  ladder: LadderResult[];
  rateLimit: Awaited<ReturnType<typeof scenarioRateLimitHit>>;
  maxContext: Awaited<ReturnType<typeof scenarioMaxContext>>;
  badAuth: Awaited<ReturnType<typeof scenarioBadAuth>>;
  badModel: Awaited<ReturnType<typeof scenarioBadModel>>;
}): string {
  const ladderRows = payload.ladder
    .map(
      (r) =>
        `| ${r.n} | ${r.okCount} | ${r.errorCount} | ${r.totalMs} | ${r.mean ?? "n/a"} | ${r.p50 ?? "n/a"} | ${r.p95 ?? "n/a"} | ${r.p99 ?? "n/a"} | ${r.errorStatuses.length ? r.errorStatuses.join(",") : "—"} |`,
    )
    .join("\n");

  const verdict = (b: boolean) => (b ? "✅ PASS" : "❌ FAIL");

  return `# Day 30 — Local LLM HTTP service load-test report

Generated at: ${payload.generatedAt}
Base URL:     ${payload.baseUrl}
Model:        ${payload.model}
Hardware:     ${payload.hardware ?? "unknown (llmfit not available)"}
/health:      ${payload.health.ok ? `ok, ollama=${payload.health.ollama}` : `unreachable`}

## Summary

| Scenario              | Verdict |
|-----------------------|---------|
| Smoke (1 request)     | ${verdict(payload.smoke.pass)} |
| Concurrency ladder    | ${verdict(payload.ladder.every((r) => r.okCount === r.n))} |
| Rate limit (1 key)    | ${verdict(payload.rateLimit.pass)} |
| Max context reject    | ${verdict(payload.maxContext.pass)} |
| Bad auth → 401        | ${verdict(payload.badAuth.pass)} |
| Bad model → 400       | ${verdict(payload.badModel.pass)} |

## 1. Smoke

- HTTP status: \`${payload.smoke.status}\`
- Latency: \`${payload.smoke.latencyMs} ms\`
- Verdict: ${verdict(payload.smoke.pass)}

## 2. Concurrency ladder

Запросы прогоняются параллельно через \`Promise.all\`. Перед каждой фазой —
${COOLDOWN_BEFORE_LADDER_SEC}s паузы для пополнения rate-limit корзины.
Latency приведена для успешных запросов (HTTP 200), мс.

| N parallel | OK | Errors | Wall-time, ms | Mean | p50 | p95 | p99 | Error statuses |
|-----------:|---:|-------:|--------------:|-----:|----:|----:|----:|:---------------|
${ladderRows}

> Wall-time = время от старта batch'а до возврата всех ответов. На single-GPU
> Ollama сериализует инференс — wall-time растёт ~линейно с N.

## 3. Rate limit hit (single key)

Параллельно отправлено \`${payload.rateLimit.total}\` запросов на один ключ.

- HTTP 200: \`${payload.rateLimit.status200}\`
- HTTP 429: \`${payload.rateLimit.status429}\`
- Все коды: \`${payload.rateLimit.statuses.join(", ")}\`
- Verdict: ${verdict(payload.rateLimit.pass)} (хотя бы один 429 ожидается при default capacity=10)

## 4. Max context reject

Отправлен запрос с \`messages[0].content\` ≈ 10K токенов.

- HTTP status: \`${payload.maxContext.status}\` (ожидается 413)
- Body: \`${JSON.stringify(payload.maxContext.body).slice(0, 200)}\`
- Verdict: ${verdict(payload.maxContext.pass)}

## 5. Bad auth → 401

Запрос с \`Authorization: Bearer this-is-not-a-valid-key\`.

- HTTP status: \`${payload.badAuth.status}\` (ожидается 401)
- Body: \`${JSON.stringify(payload.badAuth.body)}\`
- Verdict: ${verdict(payload.badAuth.pass)}

## 6. Bad model → 400

Запрос с моделью, не входящей в allowlist.

- HTTP status: \`${payload.badModel.status}\` (ожидается 400)
- Body: \`${JSON.stringify(payload.badModel.body).slice(0, 300)}\`
- Verdict: ${verdict(payload.badModel.pass)}

---

Raw данные (latency-массивы и тела ответов) сохранены в
\`scripts/day30/raw/load-test-${RUN_TS}.json\`.
`;
}

async function main() {
  console.log(`[day30 load-test] base=${BASE_URL} model=${MODEL}`);
  const health = await checkServiceUp();
  if (!health.ok) {
    console.error(`Service at ${BASE_URL} unreachable. Start it with: bun run server`);
    process.exit(1);
  }
  console.log(`[day30 load-test] /health ok, ollama=${health.ollama}`);

  const smoke = await scenarioSmoke();
  if (!smoke.pass) {
    console.error("Smoke failed — aborting deeper scenarios.");
    console.error(`status=${smoke.status} latencyMs=${smoke.latencyMs}`);
  }
  const ladder = await scenarioConcurrencyLadder(CONCURRENCY_LEVELS);
  const rateLimit = await scenarioRateLimitHit();
  const maxContext = await scenarioMaxContext();
  const badAuth = await scenarioBadAuth();
  const badModel = await scenarioBadModel();

  const payload = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    model: MODEL,
    hardware: tryHardwareSnapshot(),
    health,
    smoke,
    ladder,
    rateLimit,
    maxContext,
    badAuth,
    badModel,
  };

  const md = renderReport(payload);
  writeFileSync(REPORT_PATH, md, "utf8");
  writeFileSync(RAW_PATH, JSON.stringify(payload, null, 2), "utf8");

  console.log(`[day30 load-test] report  -> ${REPORT_PATH}`);
  console.log(`[day30 load-test] raw     -> ${RAW_PATH}`);

  const allPass =
    smoke.pass &&
    ladder.every((r) => r.okCount === r.n) &&
    rateLimit.pass &&
    maxContext.pass &&
    badAuth.pass &&
    badModel.pass;

  process.exit(allPass ? 0 : 1);
}

await main();
