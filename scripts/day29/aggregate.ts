import { readFileSync, writeFileSync } from "node:fs";
import pc from "picocolors";

type RunEntry = {
  questionId: string;
  modeName: string;
  runIndex: number;
  latencyMs: number;
  answer: string;
  cloudJudge?: { score: number; verdict: string };
  localJudge?: { score: number; verdict: string };
  refusal: { refused: boolean; matchedRefusalPhrase: string | null; foundTopicalTerm: string | null } | null;
};

type VramSnap = {
  gpuMemoryUsedMb: number | null;
  partialOffload: boolean;
  ollamaProcesses?: Array<{ name: string; size: string; processor: string }>;
};

function isRealPartial(snap: VramSnap): boolean {
  // Reliable check: processor contains both "CPU" and "GPU".
  // Old format had bug marking "100% GPU" as partial; we ignore the stored flag.
  const procs = snap.ollamaProcesses ?? [];
  return procs.some((p) => /cpu/i.test(p.processor) && /gpu/i.test(p.processor));
}

type Artifact = {
  config: {
    name: string;
    description: string;
    model: string;
    promptVariant: string;
    temperature: number;
    maxCompletionTokens: number;
    numCtx: number | null;
  };
  meta: {
    genElapsedMs: number;
    judgeElapsedMs: number;
    cloudJudgeModel: string;
  };
  vram: {
    beforeWarmup: VramSnap;
    afterWarmup: VramSnap;
    afterGen: VramSnap;
  };
  runs: RunEntry[];
};

type Aggregated = {
  name: string;
  description: string;
  model: string;
  promptVariant: string;
  temperature: number;
  maxCompletionTokens: number;
  numCtx: number | null;
  oosCount: number;
  refusedCount: number;
  refusalRate: number;
  perQuestionRefusal: Record<string, string>;
  inScopeCloudJudgeAvg: number;
  oosCloudJudgeAvg: number;
  overallCloudJudgeAvg: number;
  overallLocalJudgeAvg: number;
  perQuestionCloudAvg: Record<string, number>;
  latencyP50Ms: number;
  latencyP95Ms: number;
  vramPeakMb: number;
  partialOffload: boolean;
  genElapsedSec: number;
};

function loadConfig(path: string): Artifact {
  return JSON.parse(readFileSync(path, "utf8")) as Artifact;
}

function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx] ?? 0;
}

function aggregate(a: Artifact): Aggregated {
  const runs = a.runs;
  const oos = runs.filter((r) => r.refusal !== null);
  const refused = oos.filter((r) => r.refusal!.refused);
  const inScope = runs.filter((r) => !r.questionId.endsWith("_oos"));
  const cAll = runs.filter((r) => r.cloudJudge).map((r) => r.cloudJudge!.score);
  const lAll = runs.filter((r) => r.localJudge).map((r) => r.localJudge!.score);
  const cIn = inScope.filter((r) => r.cloudJudge).map((r) => r.cloudJudge!.score);
  const cOos = oos.filter((r) => r.cloudJudge).map((r) => r.cloudJudge!.score);
  const lats = runs.map((r) => r.latencyMs).sort((x, y) => x - y);

  const perQuestionRefusal: Record<string, string> = {};
  const perQuestionCloudAvg: Record<string, number> = {};
  const qids = Array.from(new Set(runs.map((r) => r.questionId)));
  for (const qid of qids) {
    const rs = runs.filter((r) => r.questionId === qid);
    const cScores = rs.filter((r) => r.cloudJudge).map((r) => r.cloudJudge!.score);
    perQuestionCloudAvg[qid] = Math.round(avg(cScores) * 100) / 100;
    if (qid.endsWith("_oos")) {
      const refRs = rs.filter((r) => r.refusal?.refused).length;
      perQuestionRefusal[qid] = `${refRs}/${rs.length}`;
    }
  }

  const vramPeak = Math.max(
    a.vram.beforeWarmup.gpuMemoryUsedMb ?? 0,
    a.vram.afterWarmup.gpuMemoryUsedMb ?? 0,
    a.vram.afterGen.gpuMemoryUsedMb ?? 0,
  );

  return {
    name: a.config.name,
    description: a.config.description,
    model: a.config.model,
    promptVariant: a.config.promptVariant,
    temperature: a.config.temperature,
    maxCompletionTokens: a.config.maxCompletionTokens,
    numCtx: a.config.numCtx,
    oosCount: oos.length,
    refusedCount: refused.length,
    refusalRate: oos.length === 0 ? 0 : refused.length / oos.length,
    perQuestionRefusal,
    inScopeCloudJudgeAvg: Math.round(avg(cIn) * 100) / 100,
    oosCloudJudgeAvg: Math.round(avg(cOos) * 100) / 100,
    overallCloudJudgeAvg: Math.round(avg(cAll) * 100) / 100,
    overallLocalJudgeAvg: Math.round(avg(lAll) * 100) / 100,
    perQuestionCloudAvg,
    latencyP50Ms: Math.round(percentile(lats, 0.5)),
    latencyP95Ms: Math.round(percentile(lats, 0.95)),
    vramPeakMb: vramPeak,
    partialOffload: isRealPartial(a.vram.afterWarmup) || isRealPartial(a.vram.afterGen),
    genElapsedSec: Math.round(a.meta.genElapsedMs / 1000),
  };
}

type ParetoVerdict = "on-front" | "dominated" | "rejected";

type WithVerdict = Aggregated & { verdict: ParetoVerdict; dominatedBy: string[] };

function applyGuardRail(cfgs: Aggregated[], baselineInScope: number, delta: number): WithVerdict[] {
  const floor = baselineInScope - delta;
  return cfgs.map((c) => {
    if (c.inScopeCloudJudgeAvg < floor) {
      return { ...c, verdict: "rejected" as ParetoVerdict, dominatedBy: [] };
    }
    return { ...c, verdict: "on-front" as ParetoVerdict, dominatedBy: [] };
  });
}

function dominates(a: Aggregated, b: Aggregated): boolean {
  // a doms b iff a ≥ b on all axes and a > b on at least one.
  const aBetterRefusal = a.refusalRate >= b.refusalRate;
  const aBetterInScope = a.inScopeCloudJudgeAvg >= b.inScopeCloudJudgeAvg;
  const aBetterLatency = a.latencyP50Ms <= b.latencyP50Ms;
  const aBetterVram = a.vramPeakMb <= b.vramPeakMb;
  if (!(aBetterRefusal && aBetterInScope && aBetterLatency && aBetterVram)) return false;
  const strict =
    a.refusalRate > b.refusalRate ||
    a.inScopeCloudJudgeAvg > b.inScopeCloudJudgeAvg ||
    a.latencyP50Ms < b.latencyP50Ms ||
    a.vramPeakMb < b.vramPeakMb;
  return strict;
}

function computePareto(cfgs: WithVerdict[]): WithVerdict[] {
  const candidates = cfgs.filter((c) => c.verdict !== "rejected");
  for (const c of candidates) {
    const dominators = candidates.filter((other) => other.name !== c.name && dominates(other, c));
    if (dominators.length > 0) {
      c.verdict = "dominated";
      c.dominatedBy = dominators.map((d) => d.name);
    }
  }
  return cfgs;
}

function fmt(v: number): string {
  return v.toFixed(2);
}

function fmtLatency(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function renderReport(cfgs: WithVerdict[], guardRailFloor: number): string {
  const lines: string[] = [];
  lines.push("# Day 29 — Отчёт по оптимизации локальной LLM");
  lines.push("");
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push("Выборка: 5 вопросов (q03, q10, q11_oos, q12_oos, q13_oos) × 2 режима (baseline, rag-full) × 2 runs × 1 backend (local)");
  lines.push(`Guard-rail: in-scope cloud-judge avg >= ${fmt(guardRailFloor)} (baseline − 0.2)`);
  lines.push("");
  lines.push("## Executive summary");
  lines.push("");

  const baseline = cfgs.find((c) => c.name === "c0");
  const winners = cfgs.filter((c) => c.verdict === "on-front");
  if (winners.length === 0) {
    lines.push("**Ни одна оптимизационная конфигурация (C1-C3) не достигла Парето-улучшения над baseline C0.** См. таблицу.");
  } else {
    lines.push(`**На Парето-фронте: ${winners.map((w) => w.name).join(", ")}.**`);
  }
  lines.push("");

  lines.push("## Главный результат по цели дня");
  lines.push("");
  lines.push(`Цель: поднять refusal rate q11_oos с 0/4 до 2-4/4. Результат:`);
  lines.push("");
  lines.push("| config | q11_oos | q12_oos | q13_oos | OOS total |");
  lines.push("|---|---|---|---|---|");
  for (const c of cfgs) {
    const r = c.perQuestionRefusal;
    lines.push(`| ${c.name} | ${r.q11_oos ?? "—"} | ${r.q12_oos ?? "—"} | ${r.q13_oos ?? "—"} | ${c.refusedCount}/${c.oosCount} |`);
  }
  lines.push("");

  lines.push("## Таблица по 4 осям Парето");
  lines.push("");
  lines.push("| config | refusal | in-scope C-avg | p50 latency | VRAM (MB) | verdict |");
  lines.push("|---|---|---|---|---|---|");
  for (const c of cfgs) {
    const v = c.verdict === "rejected"
      ? `❌ rejected (in-scope ${fmt(c.inScopeCloudJudgeAvg)} < floor ${fmt(guardRailFloor)})`
      : c.verdict === "dominated"
      ? `⬇ dominated by ${c.dominatedBy.join(", ")}`
      : `✅ on-front`;
    const partial = c.partialOffload ? " ⚠partial" : "";
    lines.push(
      `| ${c.name} | ${c.refusedCount}/${c.oosCount} | ${fmt(c.inScopeCloudJudgeAvg)} | ${fmtLatency(c.latencyP50Ms)} | ${c.vramPeakMb}${partial} | ${v} |`,
    );
  }
  lines.push("");

  lines.push("## Детально по конфигам");
  lines.push("");
  for (const c of cfgs) {
    lines.push(`### ${c.name} — ${c.description}`);
    lines.push("");
    lines.push(`- model: \`${c.model}\` · promptVariant: **${c.promptVariant}** · temp=${c.temperature} · max=${c.maxCompletionTokens} · num_ctx=${c.numCtx ?? "default"}`);
    lines.push(`- overall cloud-judge avg: **${fmt(c.overallCloudJudgeAvg)}**, local-judge avg: **${fmt(c.overallLocalJudgeAvg)}**`);
    lines.push(`- in-scope (q03+q10) C-avg: **${fmt(c.inScopeCloudJudgeAvg)}**, OOS C-avg: ${fmt(c.oosCloudJudgeAvg)}`);
    lines.push(`- refusal: **${c.refusedCount}/${c.oosCount}** (${(c.refusalRate * 100).toFixed(0)}%)`);
    lines.push(`- per-question C-avg: ${Object.entries(c.perQuestionCloudAvg).map(([q, v]) => `${q}=${fmt(v)}`).join(", ")}`);
    lines.push(`- latency p50: **${fmtLatency(c.latencyP50Ms)}**, p95: ${fmtLatency(c.latencyP95Ms)}, gen elapsed: ${c.genElapsedSec}s`);
    lines.push(`- VRAM peak: **${c.vramPeakMb} MB**${c.partialOffload ? " **⚠ partial CPU/GPU offload**" : ""}`);
    lines.push("");
  }

  lines.push("## Выводы");
  lines.push("");
  if (baseline) {
    lines.push(`Baseline C0 refusal rate: **${baseline.refusedCount}/${baseline.oosCount}**. Цель дня (2-4/4) не достигнута ни одним из C1-C3. Ручной разбор — в \`analysis.md\`.`);
  }
  lines.push("");
  return lines.join("\n");
}

function main(): void {
  const configs = ["c0", "c1", "c2", "c3"];
  const loaded: Aggregated[] = [];
  for (const name of configs) {
    try {
      const art = loadConfig(`scripts/day29/raw/${name}.json`);
      loaded.push(aggregate(art));
      console.log(pc.dim(`  ✓ loaded ${name}`));
    } catch (err) {
      console.warn(pc.yellow(`  ⚠ skip ${name}: ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  const baseline = loaded.find((c) => c.name === "c0");
  if (!baseline) {
    console.error(pc.red("  c0 missing — cannot compute guard-rail"));
    process.exit(1);
  }
  const floor = baseline.inScopeCloudJudgeAvg - 0.2;

  let withVerdicts = applyGuardRail(loaded, baseline.inScopeCloudJudgeAvg, 0.2);
  withVerdicts = computePareto(withVerdicts);

  const report = renderReport(withVerdicts, floor);
  writeFileSync("scripts/day29/report.md", report, "utf8");
  console.log(pc.green(`  ✓ scripts/day29/report.md`));
}

main();
