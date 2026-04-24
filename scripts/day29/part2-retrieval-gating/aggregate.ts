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
  skippedLLM?: boolean;
  refusalReason?: string | null;
  retrieval?: { maxRelevanceScore?: number | null };
};

type VramSnap = {
  gpuMemoryUsedMb: number | null;
  ollamaProcesses?: Array<{ name: string; size: string; processor: string }>;
};

type Artifact = {
  config: {
    name: string;
    description: string;
    model: string;
    temperature: number;
    maxCompletionTokens: number;
    gatingThreshold: number | null;
  };
  meta: { genElapsedMs: number; judgeElapsedMs: number; cloudJudgeModel: string; skippedCount?: number };
  vram: { beforeWarmup: VramSnap; afterWarmup: VramSnap; afterGen: VramSnap };
  runs: RunEntry[];
};

function isRealPartial(snap: VramSnap): boolean {
  const procs = snap.ollamaProcesses ?? [];
  return procs.some((p) => /cpu/i.test(p.processor) && /gpu/i.test(p.processor));
}

type Aggregated = {
  name: string;
  description: string;
  gatingThreshold: number | null;
  oosCount: number;
  detectorRefusedCount: number;
  judgeRefusedCount: number;
  skippedLLMCount: number;
  perQuestionRefusal: Record<string, { detector: string; judge: string; skipped: string }>;
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

function avg(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, v) => s + v, 0) / xs.length;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx] ?? 0;
}

function aggregate(a: Artifact): Aggregated {
  const runs = a.runs;
  const oos = runs.filter((r) => r.refusal !== null);
  const detectorRefused = oos.filter((r) => r.refusal!.refused);
  const judgeRefused = oos.filter((r) => (r.cloudJudge?.score ?? -1) >= 2);
  const inScope = runs.filter((r) => !r.questionId.endsWith("_oos"));
  const cAll = runs.filter((r) => r.cloudJudge).map((r) => r.cloudJudge!.score);
  const lAll = runs.filter((r) => r.localJudge).map((r) => r.localJudge!.score);
  const cIn = inScope.filter((r) => r.cloudJudge).map((r) => r.cloudJudge!.score);
  const cOos = oos.filter((r) => r.cloudJudge).map((r) => r.cloudJudge!.score);
  const lats = runs.map((r) => r.latencyMs).sort((x, y) => x - y);

  const perQuestionRefusal: Record<string, { detector: string; judge: string; skipped: string }> = {};
  const perQuestionCloudAvg: Record<string, number> = {};
  const qids = Array.from(new Set(runs.map((r) => r.questionId)));
  for (const qid of qids) {
    const rs = runs.filter((r) => r.questionId === qid);
    const cScores = rs.filter((r) => r.cloudJudge).map((r) => r.cloudJudge!.score);
    perQuestionCloudAvg[qid] = Math.round(avg(cScores) * 100) / 100;
    if (qid.endsWith("_oos")) {
      const detR = rs.filter((r) => r.refusal?.refused).length;
      const judR = rs.filter((r) => (r.cloudJudge?.score ?? -1) >= 2).length;
      const skpd = rs.filter((r) => r.skippedLLM).length;
      perQuestionRefusal[qid] = {
        detector: `${detR}/${rs.length}`,
        judge: `${judR}/${rs.length}`,
        skipped: `${skpd}/${rs.length}`,
      };
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
    gatingThreshold: a.config.gatingThreshold,
    oosCount: oos.length,
    detectorRefusedCount: detectorRefused.length,
    judgeRefusedCount: judgeRefused.length,
    skippedLLMCount: runs.filter((r) => r.skippedLLM).length,
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

function dominates(a: Aggregated, b: Aggregated): boolean {
  const aBetterRefusal = a.detectorRefusedCount >= b.detectorRefusedCount;
  const aBetterInScope = a.inScopeCloudJudgeAvg >= b.inScopeCloudJudgeAvg;
  const aBetterLatency = a.latencyP50Ms <= b.latencyP50Ms;
  const aBetterVram = a.vramPeakMb <= b.vramPeakMb;
  if (!(aBetterRefusal && aBetterInScope && aBetterLatency && aBetterVram)) return false;
  return (
    a.detectorRefusedCount > b.detectorRefusedCount ||
    a.inScopeCloudJudgeAvg > b.inScopeCloudJudgeAvg ||
    a.latencyP50Ms < b.latencyP50Ms ||
    a.vramPeakMb < b.vramPeakMb
  );
}

function computePareto(cfgs: Aggregated[], floor: number): WithVerdict[] {
  const withVerdicts: WithVerdict[] = cfgs.map((c) => ({
    ...c,
    verdict: c.inScopeCloudJudgeAvg < floor ? "rejected" : "on-front",
    dominatedBy: [],
  }));
  const candidates = withVerdicts.filter((c) => c.verdict !== "rejected");
  for (const c of candidates) {
    const doms = candidates.filter((o) => o.name !== c.name && dominates(o, c));
    if (doms.length > 0) {
      c.verdict = "dominated";
      c.dominatedBy = doms.map((d) => d.name);
    }
  }
  return withVerdicts;
}

function fmt(v: number): string {
  return v.toFixed(2);
}

function fmtLatency(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function renderReport(cfgs: WithVerdict[], floor: number, baselineName: string): string {
  const lines: string[] = [];
  lines.push("# Day 29 part 2 — Retrieval-gating Отчёт");
  lines.push("");
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push("Выборка: 5 вопросов (q03, q10, q11_oos, q12b_oos, q13_oos) × 2 режима × 2 runs × 1 backend (local)");
  lines.push(`Baseline: **${baselineName}**. Guard-rail: in-scope cloud-judge avg >= **${fmt(floor)}** (D0 baseline − 0.2).`);
  lines.push("");
  lines.push("## Executive summary");
  lines.push("");
  const winners = cfgs.filter((c) => c.verdict === "on-front");
  if (winners.length === 0) {
    lines.push("**Ни одна конфигурация не на Парето-фронте.**");
  } else {
    lines.push(`**На Парето-фронте: ${winners.map((w) => w.name).join(", ")}.**`);
  }
  const best = [...cfgs].sort((a, b) => b.detectorRefusedCount - a.detectorRefusedCount)[0];
  if (best) {
    lines.push("");
    lines.push(`**Лучший по detector-refusal**: **${best.name}** с ${best.detectorRefusedCount}/${best.oosCount} отказов.`);
    lines.push("");
    lines.push(`Цель part1 (refusal 2-4/4 на q11_oos) — **${best.detectorRefusedCount >= 2 ? "ДОСТИГНУТА" : "не достигнута"}**.`);
  }
  lines.push("");

  lines.push("## Главный результат по цели");
  lines.push("");
  lines.push("| config | threshold | q11_oos | q12b_oos | q13_oos | Detector total | Judge total | Skipped LLM |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const c of cfgs) {
    const r = c.perQuestionRefusal;
    const thr = c.gatingThreshold === null ? "—" : fmt(c.gatingThreshold);
    lines.push(
      `| ${c.name} | ${thr} | ${r.q11_oos?.detector ?? "—"} | ${r.q12b_oos?.detector ?? "—"} | ${r.q13_oos?.detector ?? "—"} | ${c.detectorRefusedCount}/${c.oosCount} | ${c.judgeRefusedCount}/${c.oosCount} | ${c.skippedLLMCount}/20 |`,
    );
  }
  lines.push("");

  lines.push("## Парето-таблица (4 оси)");
  lines.push("");
  lines.push("| config | refusal | in-scope C-avg | p50 latency | VRAM (MB) | verdict |");
  lines.push("|---|---|---|---|---|---|");
  for (const c of cfgs) {
    const verdict = c.verdict === "rejected"
      ? `❌ rejected (in-scope ${fmt(c.inScopeCloudJudgeAvg)} < ${fmt(floor)})`
      : c.verdict === "dominated"
      ? `⬇ dominated by ${c.dominatedBy.join(", ")}`
      : `✅ on-front`;
    const partial = c.partialOffload ? " ⚠partial" : "";
    lines.push(
      `| ${c.name} | ${c.detectorRefusedCount}/${c.oosCount} | ${fmt(c.inScopeCloudJudgeAvg)} | ${fmtLatency(c.latencyP50Ms)} | ${c.vramPeakMb}${partial} | ${verdict} |`,
    );
  }
  lines.push("");

  lines.push("## Детально по конфигам");
  lines.push("");
  for (const c of cfgs) {
    lines.push(`### ${c.name} — ${c.description}`);
    lines.push("");
    lines.push(`- gating threshold: **${c.gatingThreshold === null ? "disabled" : fmt(c.gatingThreshold)}**`);
    lines.push(`- overall cloud-judge avg: ${fmt(c.overallCloudJudgeAvg)}, local-judge avg: ${fmt(c.overallLocalJudgeAvg)}`);
    lines.push(`- in-scope (q03+q10) C-avg: **${fmt(c.inScopeCloudJudgeAvg)}**, OOS C-avg: ${fmt(c.oosCloudJudgeAvg)}`);
    lines.push(`- detector refusal: **${c.detectorRefusedCount}/${c.oosCount}**, judge refusal: ${c.judgeRefusedCount}/${c.oosCount}, skipped LLM: ${c.skippedLLMCount}/20`);
    lines.push(`- per-question C-avg: ${Object.entries(c.perQuestionCloudAvg).map(([q, v]) => `${q}=${fmt(v)}`).join(", ")}`);
    if (Object.keys(c.perQuestionRefusal).length > 0) {
      lines.push(`- per-question refusal (detector | judge | skipped):`);
      for (const [q, r] of Object.entries(c.perQuestionRefusal)) {
        lines.push(`    - ${q}: detector=${r.detector}, judge=${r.judge}, skipped=${r.skipped}`);
      }
    }
    lines.push(`- latency p50: **${fmtLatency(c.latencyP50Ms)}**, p95: ${fmtLatency(c.latencyP95Ms)}, gen elapsed: ${c.genElapsedSec}s`);
    lines.push(`- VRAM peak: ${c.vramPeakMb} MB${c.partialOffload ? " ⚠ partial CPU/GPU offload" : ""}`);
    lines.push("");
  }

  return lines.join("\n");
}

function main(): void {
  const configs = ["d0", "d1", "d2", "d3"];
  const loaded: Aggregated[] = [];
  for (const name of configs) {
    try {
      const raw = readFileSync(`scripts/day29/part2-retrieval-gating/raw/${name}.json`, "utf8");
      loaded.push(aggregate(JSON.parse(raw) as Artifact));
      console.log(pc.dim(`  ✓ loaded ${name}`));
    } catch (err) {
      console.warn(pc.yellow(`  ⚠ skip ${name}: ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  const baseline = loaded.find((c) => c.name === "d0");
  if (!baseline) {
    console.error(pc.red("  d0 missing — cannot compute guard-rail"));
    process.exit(1);
  }
  const floor = baseline.inScopeCloudJudgeAvg - 0.2;
  const withVerdicts = computePareto(loaded, floor);

  const report = renderReport(withVerdicts, floor, baseline.name);
  writeFileSync("scripts/day29/part2-retrieval-gating/report.md", report, "utf8");
  console.log(pc.green(`  ✓ scripts/day29/part2-retrieval-gating/report.md`));
}

main();
