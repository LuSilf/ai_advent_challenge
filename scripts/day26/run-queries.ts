import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import OpenAI from "openai";
import pc from "picocolors";

import { initDb, getModel, calculateCost } from "../../src/db";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1";
const OLLAMA_HOST_URL = OLLAMA_BASE_URL.replace(/\/v1\/?$/, "");
const CLOUD_BASE_URL = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
const CLOUD_API_KEY = process.env.OPENAI_API_KEY ?? "";
const CLOUD_MODEL = process.env.OPENAI_MODEL ?? "";
const HISTORY_DB = process.env.HISTORY_DB ?? "./data/history.db";

const DAY26_DIR = join(process.cwd(), "scripts", "day26");
const QUERIES_PATH = join(DAY26_DIR, "queries.json");
const REPORT_PATH = join(DAY26_DIR, "report.md");
const CONCLUSIONS_PATH = join(DAY26_DIR, "conclusions.md");

const TEMPERATURE = 0;
const SEED = 42;
const REQUEST_TIMEOUT_MS = 180_000;

type Query = {
  id: string;
  category: "factual" | "reasoning" | "code";
  prompt: string;
  description: string;
  expectedLanguage: string;
};

type Target = {
  id: string;
  label: string;
  kind: "local" | "cloud";
  baseUrl: string;
  apiKey: string;
  model: string;
};

type QueryResult = {
  target: Target;
  query: Query;
  latencyMs: number;
  answer: string;
  promptTokens: number;
  completionTokens: number;
  finishReason: string;
  costUsd: number | null;
};

type Failure = {
  target: Target;
  query: Query;
  message: string;
};

type HardwareSnapshot = {
  cpu?: string;
  ramTotalGb?: number;
  backend?: string;
  gpu?: string;
  vramGb?: number;
  rawError?: string;
};

const LOCAL_TARGETS: Target[] = [
  {
    id: "ollama-qwen2.5-coder-7b",
    label: "qwen2.5-coder:7b (local)",
    kind: "local",
    baseUrl: OLLAMA_BASE_URL,
    apiKey: "ollama",
    model: "qwen2.5-coder:7b",
  },
  {
    id: "ollama-llama3.2-3b",
    label: "llama3.2:3b (local)",
    kind: "local",
    baseUrl: OLLAMA_BASE_URL,
    apiKey: "ollama",
    model: "llama3.2:3b",
  },
];

function buildCloudTarget(): Target | null {
  if (!CLOUD_API_KEY || !CLOUD_MODEL) return null;
  return {
    id: "cloud",
    label: `${CLOUD_MODEL} (cloud)`,
    kind: "cloud",
    baseUrl: CLOUD_BASE_URL,
    apiKey: CLOUD_API_KEY,
    model: CLOUD_MODEL,
  };
}

function loadQueries(): Query[] {
  const raw = readFileSync(QUERIES_PATH, "utf8");
  const parsed = JSON.parse(raw) as Query[];
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`queries.json пуст или не массив: ${QUERIES_PATH}`);
  }
  return parsed;
}

async function listOllamaModels(): Promise<string[]> {
  const res = await fetch(`${OLLAMA_HOST_URL}/api/tags`);
  if (!res.ok) {
    throw new Error(`Ollama /api/tags вернул ${res.status}`);
  }
  const body = (await res.json()) as { models?: Array<{ name: string }> };
  return (body.models ?? []).map((m) => m.name);
}

async function preflightLocal(targets: Target[]): Promise<void> {
  const localTargets = targets.filter((t) => t.kind === "local");
  if (localTargets.length === 0) return;

  let available: string[];
  try {
    available = await listOllamaModels();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Ollama недоступен (${OLLAMA_HOST_URL}): ${message}. Проверь, что ollama serve запущен.`);
  }

  const missing = localTargets.filter((t) => !available.includes(t.model));
  if (missing.length > 0) {
    const pullLines = missing.map((t) => `  ollama pull ${t.model}`).join("\n");
    throw new Error(`В Ollama отсутствуют модели:\n${pullLines}`);
  }
}

async function smokePing(target: Target): Promise<void> {
  const client = new OpenAI({ baseURL: target.baseUrl, apiKey: target.apiKey, timeout: REQUEST_TIMEOUT_MS });
  await client.chat.completions.create({
    model: target.model,
    messages: [{ role: "user", content: "Say 'ok'" }],
    temperature: TEMPERATURE,
    seed: SEED,
  });
}

function computeCost(target: Target, promptTokens: number, completionTokens: number): number | null {
  if (target.kind === "local") return 0;
  const model = getModel(target.model);
  if (!model) return null;
  return calculateCost(model, promptTokens, completionTokens).cost;
}

async function runQuery(target: Target, query: Query): Promise<QueryResult> {
  const client = new OpenAI({ baseURL: target.baseUrl, apiKey: target.apiKey, timeout: REQUEST_TIMEOUT_MS });
  const startedAt = performance.now();
  const response = await client.chat.completions.create({
    model: target.model,
    messages: [{ role: "user", content: query.prompt }],
    temperature: TEMPERATURE,
    seed: SEED,
  });
  const latencyMs = Math.round(performance.now() - startedAt);

  const choice = response.choices[0];
  const answer = choice?.message?.content ?? "";
  const finishReason = choice?.finish_reason ?? "unknown";
  const promptTokens = response.usage?.prompt_tokens ?? 0;
  const completionTokens = response.usage?.completion_tokens ?? 0;

  return {
    target,
    query,
    latencyMs,
    answer,
    promptTokens,
    completionTokens,
    finishReason,
    costUsd: computeCost(target, promptTokens, completionTokens),
  };
}

function tokensPerSec(result: QueryResult): number {
  if (result.latencyMs <= 0) return 0;
  return +(result.completionTokens / (result.latencyMs / 1000)).toFixed(2);
}

function formatCost(cost: number | null, kind: "local" | "cloud"): string {
  if (cost === null) return "n/a";
  if (kind === "local") return "$0.000000";
  return cost < 0.01 ? `$${cost.toFixed(6)}` : `$${cost.toFixed(4)}`;
}

function snapshotHardware(): HardwareSnapshot {
  try {
    const raw = execFileSync("llmfit", ["system", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const parsed = JSON.parse(raw) as { system?: Record<string, unknown> };
    const sys = parsed.system ?? {};
    return {
      cpu: typeof sys.cpu_name === "string" ? sys.cpu_name : undefined,
      ramTotalGb: typeof sys.total_ram_gb === "number" ? sys.total_ram_gb : undefined,
      backend: typeof sys.backend === "string" ? sys.backend : undefined,
      gpu: typeof sys.gpu_name === "string" ? sys.gpu_name : undefined,
      vramGb: typeof sys.gpu_vram_gb === "number" ? sys.gpu_vram_gb : undefined,
    };
  } catch (error) {
    return { rawError: error instanceof Error ? error.message : String(error) };
  }
}

function renderReport(
  results: QueryResult[],
  failures: Failure[],
  queries: Query[],
  targets: Target[],
  skippedCloud: boolean,
  hardware: HardwareSnapshot
): string {
  const lines: string[] = [];
  lines.push(`# Day 26 — Local LLM smoke-benchmark report`);
  lines.push("");
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push("");

  lines.push(`## Hardware`);
  if (hardware.rawError) {
    lines.push(`- llmfit unavailable: ${hardware.rawError}`);
  } else {
    if (hardware.cpu) lines.push(`- CPU: ${hardware.cpu}`);
    if (hardware.ramTotalGb !== undefined) lines.push(`- RAM: ${hardware.ramTotalGb} GB`);
    if (hardware.backend) lines.push(`- Backend: ${hardware.backend}`);
    if (hardware.gpu) lines.push(`- GPU: ${hardware.gpu}`);
    if (hardware.vramGb !== undefined) lines.push(`- VRAM: ${hardware.vramGb} GB`);
  }
  lines.push("");

  lines.push(`## Configuration`);
  lines.push(`- temperature=${TEMPERATURE}, seed=${SEED}`);
  lines.push(`- Ollama base URL: ${OLLAMA_BASE_URL}`);
  if (skippedCloud) {
    lines.push(`- Cloud target: skipped (OPENAI_API_KEY / OPENAI_MODEL not set)`);
  } else {
    lines.push(`- Cloud base URL: ${CLOUD_BASE_URL}`);
  }
  lines.push(`- Targets:`);
  for (const t of targets) {
    lines.push(`  - ${t.label} — model \`${t.model}\``);
  }
  lines.push("");

  lines.push(`## Summary`);
  const header = ["Target", ...queries.map((q) => `${q.id} latency / tps / cost`)];
  lines.push(`| ${header.join(" | ")} |`);
  lines.push(`| ${header.map(() => "---").join(" | ")} |`);
  for (const t of targets) {
    const cells: string[] = [t.label];
    for (const q of queries) {
      const r = results.find((x) => x.target.id === t.id && x.query.id === q.id);
      if (!r) {
        cells.push("— (failed)");
      } else {
        cells.push(`${r.latencyMs} ms / ${tokensPerSec(r)} tps / ${formatCost(r.costUsd, t.kind)}`);
      }
    }
    lines.push(`| ${cells.join(" | ")} |`);
  }
  lines.push("");

  if (skippedCloud) {
    lines.push(`## Cloud reference — skipped (OPENAI_API_KEY not set)`);
    lines.push("");
  }

  for (const query of queries) {
    lines.push(`## ${query.id} — ${query.category}`);
    lines.push("");
    lines.push(`**Prompt:** ${query.prompt}`);
    lines.push("");
    for (const target of targets) {
      const r = results.find((x) => x.target.id === target.id && x.query.id === query.id);
      lines.push(`### ${target.label}`);
      if (!r) {
        const f = failures.find((x) => x.target.id === target.id && x.query.id === query.id);
        lines.push(`- **Failed**: ${f?.message ?? "unknown error"}`);
        lines.push("");
        continue;
      }
      lines.push(`- Latency: ${r.latencyMs} ms`);
      lines.push(`- Prompt tokens: ${r.promptTokens}, Completion tokens: ${r.completionTokens}, tokens/sec: ${tokensPerSec(r)}`);
      lines.push(`- finish_reason: \`${r.finishReason}\``);
      lines.push(`- Cost: ${formatCost(r.costUsd, target.kind)}`);
      lines.push("");
      lines.push("**Answer:**");
      lines.push("");
      lines.push("```");
      lines.push(r.answer);
      lines.push("```");
      lines.push("");
    }
  }

  if (failures.length > 0) {
    lines.push(`## Failures`);
    for (const f of failures) {
      lines.push(`- **${f.target.label}** on ${f.query.id}: ${f.message}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function ensureConclusionsSkeleton(): void {
  if (existsSync(CONCLUSIONS_PATH)) return;
  const skeleton = [
    `# Day 26 — Conclusions`,
    "",
    "_Заполняется руками после прогона `bun run day26-local`. Автораннер трогает этот файл только при первом создании._",
    "",
    `## Что удивило`,
    "",
    `- ...`,
    "",
    `## Где local уступил cloud`,
    "",
    `- ...`,
    "",
    `## Где local не уступил (или обогнал)`,
    "",
    `- ...`,
    "",
    `## Детерминизм (temperature=0, seed=42)`,
    "",
    `- Повторный прогон: stable / drifting (заполнить после второго прогона)`,
    "",
    `## Downgrades / проблемы`,
    "",
    `- ...`,
    "",
    `## Next steps (day 27+)`,
    "",
    `- ...`,
    "",
  ].join("\n");
  writeFileSync(CONCLUSIONS_PATH, skeleton, "utf8");
  console.log(pc.green(`✓ Создан skeleton ${CONCLUSIONS_PATH}`));
}

async function main(): Promise<void> {
  initDb(HISTORY_DB);

  const queries = loadQueries();
  const cloud = buildCloudTarget();
  const skippedCloud = cloud === null;
  const targets: Target[] = skippedCloud ? [...LOCAL_TARGETS] : [...LOCAL_TARGETS, cloud];

  if (skippedCloud) {
    console.log(pc.yellow(`⚠ Cloud-target пропущен: OPENAI_API_KEY или OPENAI_MODEL не заданы`));
  }

  const hardware = snapshotHardware();
  if (hardware.rawError) {
    console.log(pc.yellow(`⚠ llmfit unavailable: ${hardware.rawError}`));
  }

  console.log(pc.bold(`Preflight: проверяю Ollama и модели...`));
  await preflightLocal(targets);
  console.log(pc.green(`✓ Все local модели доступны в Ollama`));

  console.log(pc.bold(`Smoke-ping по каждому target'у...`));
  for (const t of targets) {
    try {
      await smokePing(t);
      console.log(pc.green(`  ✓ ${t.label}`));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Smoke-ping ${t.label} упал: ${message}`);
    }
  }

  const results: QueryResult[] = [];
  const failures: Failure[] = [];

  for (const target of targets) {
    for (const query of queries) {
      process.stdout.write(pc.dim(`  ${target.label} × ${query.id} ... `));
      try {
        const r = await runQuery(target, query);
        results.push(r);
        console.log(pc.green(`${r.latencyMs}ms`));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ target, query, message });
        console.log(pc.red(`FAIL: ${message}`));
      }
    }
  }

  const report = renderReport(results, failures, queries, targets, skippedCloud, hardware);
  writeFileSync(REPORT_PATH, report, "utf8");
  console.log(pc.bold(pc.green(`✓ Отчёт записан в ${REPORT_PATH}`)));

  ensureConclusionsSkeleton();

  if (failures.length > 0) {
    console.log(pc.yellow(`⚠ ${failures.length} failures — см. секцию Failures в отчёте`));
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(pc.red(`Ошибка: ${message}`));
  process.exit(1);
});
