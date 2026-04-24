import type { JudgedAnswerRun } from "./dual-judge-service";
import type { ControlQuestion } from "./rag-evaluation-service";
import {
  aggregateByModeBackend,
  computeJudgeAgreement,
  findTopUnstable,
  selectSideBySideExamples,
  type ModeBackendCell,
  type UnstableRow,
  type SideBySideExample,
} from "./rag-dual-backend-stats";

export type ReportOptions = {
  generatedAt: string;
  strategy: string;
  localModel: string;
  cloudModel: string;
  runsPerCell: number;
  temperature: number;
};

export type ReportInput = {
  runs: JudgedAnswerRun[];
  questions: ControlQuestion[];
  options: ReportOptions;
};

const EM_DASH = "—";

export function renderDualBackendReport(input: ReportInput): string {
  const { runs, questions, options } = input;
  const cells = aggregateByModeBackend(runs);
  const lines: string[] = [];

  lines.push("# Day 28 — Local RAG vs Cloud RAG comparison report");
  lines.push("");
  lines.push(`Generated at: ${options.generatedAt}`);
  lines.push(`Strategy: **${options.strategy}**`);
  lines.push(`Local model: \`${options.localModel}\``);
  lines.push(`Cloud model: \`${options.cloudModel}\``);
  lines.push(`Runs per (question × mode × backend): **${options.runsPerCell}**`);
  lines.push(`Temperature: ${options.temperature}`);
  lines.push("");

  lines.push(...renderExecutiveSummary(runs, cells));
  lines.push("");
  lines.push(...renderMainTable(cells));
  lines.push("");
  lines.push(...renderPerQuestionBreakdown(runs, questions));
  lines.push("");
  lines.push(...renderStabilitySection(runs));
  lines.push("");
  lines.push(...renderDualJudgeAgreement(runs));
  lines.push("");
  lines.push(...renderSideBySide(runs, questions));
  lines.push("");
  lines.push(...renderImpressionsPlaceholder());
  lines.push("");

  return lines.join("\n");
}

function renderExecutiveSummary(
  runs: JudgedAnswerRun[],
  cells: ModeBackendCell[],
): string[] {
  const lines: string[] = ["## Executive summary", ""];

  const localCells = cells.filter((c) => c.backendName === "local");
  const cloudCells = cells.filter((c) => c.backendName === "cloud");
  const avgField = (xs: ModeBackendCell[], f: (c: ModeBackendCell) => number | null): number | null => {
    const vals = xs.map(f).filter((v): v is number => v !== null);
    if (vals.length === 0) return null;
    return vals.reduce((s, v) => s + v, 0) / vals.length;
  };

  const avgLocalCloudJudge = avgField(localCells, (c) => c.cloudJudgeAvg);
  const avgCloudCloudJudge = avgField(cloudCells, (c) => c.cloudJudgeAvg);
  const avgLocalLocalJudge = avgField(localCells, (c) => c.localJudgeAvg);
  const avgCloudLocalJudge = avgField(cloudCells, (c) => c.localJudgeAvg);

  const p50Local = avgField(localCells, (c) => c.latency.p50);
  const p50Cloud = avgField(cloudCells, (c) => c.latency.p50);

  const errLocal = localCells.reduce((s, c) => s + c.errors, 0);
  const errCloud = cloudCells.reduce((s, c) => s + c.errors, 0);
  const totalLocal = localCells.reduce((s, c) => s + c.total, 0);
  const totalCloud = cloudCells.reduce((s, c) => s + c.total, 0);

  lines.push(
    `- **Cloud judge** avg: local backend ${fmt(avgLocalCloudJudge)} vs cloud backend ${fmt(avgCloudCloudJudge)} (diff ${fmtDiff(avgLocalCloudJudge, avgCloudCloudJudge)}).`,
  );
  lines.push(
    `- **Local judge** avg: local backend ${fmt(avgLocalLocalJudge)} vs cloud backend ${fmt(avgCloudLocalJudge)} (diff ${fmtDiff(avgLocalLocalJudge, avgCloudLocalJudge)}).`,
  );
  lines.push(
    `- **Latency p50**: local ${fmtMs(p50Local)} vs cloud ${fmtMs(p50Cloud)}.`,
  );
  lines.push(
    `- **Errors**: local ${errLocal}/${totalLocal}, cloud ${errCloud}/${totalCloud}.`,
  );
  lines.push(
    `- **Verdict**: ${synthVerdict(avgLocalCloudJudge, avgCloudCloudJudge, p50Local, p50Cloud)}.`,
  );
  return lines;
}

function synthVerdict(
  avgLocal: number | null,
  avgCloud: number | null,
  p50Local: number | null,
  p50Cloud: number | null,
): string {
  if (avgLocal === null || avgCloud === null) return "data incomplete";
  const gap = avgCloud - avgLocal;
  const gapPct = avgCloud === 0 ? 0 : (gap / 3) * 100;
  let quality: string;
  if (gap <= 0.1) quality = "качество сопоставимо";
  else if (gap <= 0.5) quality = `local немного уступает cloud (~${gapPct.toFixed(0)}% шкалы)`;
  else quality = `local заметно уступает cloud (~${gapPct.toFixed(0)}% шкалы)`;
  if (p50Local !== null && p50Cloud !== null) {
    const ratio = p50Local / p50Cloud;
    const speed = ratio > 1.2 ? `в ${ratio.toFixed(1)}x медленнее` : ratio < 0.8 ? `в ${(1 / ratio).toFixed(1)}x быстрее` : "сопоставимо по скорости";
    return `${quality}; ${speed}`;
  }
  return quality;
}

function renderMainTable(cells: ModeBackendCell[]): string[] {
  const lines: string[] = ["## Mode × backend", ""];
  lines.push("| mode | backend | C-judge | L-judge | p50 (ms) | p95 (ms) | std C | std L | std lat | errors |");
  lines.push("|------|---------|---------|---------|----------|----------|-------|-------|---------|--------|");
  for (const c of cells) {
    lines.push(
      `| ${c.modeName} | ${c.backendName} | ${fmt(c.cloudJudgeAvg)} | ${fmt(c.localJudgeAvg)} | ${fmtMs(c.latency.p50)} | ${fmtMs(c.latency.p95)} | ${fmt(c.cloudJudgeStd)} | ${fmt(c.localJudgeStd)} | ${fmtMs(c.latency.std)} | ${c.errors}/${c.total} |`,
    );
  }
  return lines;
}

function renderPerQuestionBreakdown(
  runs: JudgedAnswerRun[],
  questions: ControlQuestion[],
): string[] {
  const lines: string[] = ["## Per-question breakdown", ""];
  lines.push("Best cloud-judge score per (question × backend) across all modes (max over modes, avg over runs):");
  lines.push("");
  lines.push("| qid | question | best local | best cloud | diff | local проиграл? |");
  lines.push("|-----|----------|-----------|------------|------|------------------|");
  const questionText = new Map(questions.map((q) => [q.id, q.question]));

  const byQuestion = new Map<string, JudgedAnswerRun[]>();
  for (const r of runs) {
    if (!byQuestion.has(r.questionId)) byQuestion.set(r.questionId, []);
    byQuestion.get(r.questionId)!.push(r);
  }

  for (const q of questions) {
    const qRuns = byQuestion.get(q.id) ?? [];
    const bestLocal = bestScorePerBackend(qRuns, "local");
    const bestCloud = bestScorePerBackend(qRuns, "cloud");
    const diff = bestCloud !== null && bestLocal !== null ? bestCloud - bestLocal : null;
    const lost = diff !== null && diff >= 1 ? "yes" : diff !== null ? "no" : "—";
    const qText = (questionText.get(q.id) ?? "").slice(0, 80);
    lines.push(
      `| ${q.id} | ${escapePipe(qText)} | ${fmt(bestLocal)} | ${fmt(bestCloud)} | ${fmtDiff(bestLocal, bestCloud)} | ${lost} |`,
    );
  }
  return lines;
}

function bestScorePerBackend(runs: JudgedAnswerRun[], backend: string): number | null {
  const byMode = new Map<string, number[]>();
  for (const r of runs) {
    if (r.backendName !== backend) continue;
    const s = r.cloudJudge?.score;
    if (typeof s !== "number") continue;
    if (!byMode.has(r.modeName)) byMode.set(r.modeName, []);
    byMode.get(r.modeName)!.push(s);
  }
  const perMode = Array.from(byMode.values()).map(
    (xs) => xs.reduce((s, v) => s + v, 0) / xs.length,
  );
  if (perMode.length === 0) return null;
  return Math.max(...perMode);
}

function renderStabilitySection(runs: JudgedAnswerRun[]): string[] {
  const lines: string[] = ["## Stability", ""];

  const topJudge = findTopUnstable(runs, "judge", 3);
  if (topJudge.length > 0) {
    lines.push("### Top-3 most unstable by judge std");
    lines.push("");
    lines.push("| qid | mode | backend | runs | meanC | stdC | meanL | stdL |");
    lines.push("|-----|------|---------|------|-------|------|-------|------|");
    for (const r of topJudge) {
      lines.push(
        `| ${r.questionId} | ${r.modeName} | ${r.backendName} | ${r.runs} | ${fmt(r.meanCloud)} | ${fmt(r.stdCloud)} | ${fmt(r.meanLocal)} | ${fmt(r.stdLocal)} |`,
      );
    }
    lines.push("");
  }

  const topLatency = findTopUnstable(runs, "latency", 3);
  if (topLatency.length > 0) {
    lines.push("### Top-3 most unstable by latency std");
    lines.push("");
    lines.push("| qid | mode | backend | runs | meanLat (ms) | stdLat (ms) |");
    lines.push("|-----|------|---------|------|--------------|-------------|");
    for (const r of topLatency) {
      lines.push(
        `| ${r.questionId} | ${r.modeName} | ${r.backendName} | ${r.runs} | ${fmtMs(r.meanLatency)} | ${fmtMs(r.stdLatency)} |`,
      );
    }
    lines.push("");
  }

  lines.push("### Sequential local-backend latency");
  lines.push("");
  lines.push("Order matches matrix traversal (`question → mode → backend → run`), filtered to `backend=local`.");
  lines.push("");
  const seqLocal = runs.filter((r) => r.backendName === "local");
  lines.push("| # | qid | mode | run | latency (ms) | status |");
  lines.push("|---|-----|------|-----|--------------|--------|");
  seqLocal.forEach((r, idx) => {
    const status = r.error ? `ERR ${r.errorClass ?? "?"}` : "ok";
    lines.push(
      `| ${idx + 1} | ${r.questionId} | ${r.modeName} | ${r.runIndex} | ${r.latencyMs} | ${status} |`,
    );
  });
  return lines;
}

function renderDualJudgeAgreement(runs: JudgedAnswerRun[]): string[] {
  const lines: string[] = ["## Dual-judge agreement", ""];
  const scoredRuns = runs.filter((r) => r.cloudJudge && r.localJudge);
  const allPairs: Array<[number, number]> = scoredRuns.map((r) => [
    r.cloudJudge!.score,
    r.localJudge!.score,
  ]);
  const overall = computeJudgeAgreement(allPairs);
  lines.push(`**Overall** (${overall.count} pairs): exact=${overall.exact}, ±1=${overall.within1}, ≥2=${overall.off2plus}, pearson=${fmt(overall.pearson)}`);
  lines.push("");

  const byBackend = new Map<string, Array<[number, number]>>();
  for (const r of scoredRuns) {
    if (!byBackend.has(r.backendName)) byBackend.set(r.backendName, []);
    byBackend.get(r.backendName)!.push([r.cloudJudge!.score, r.localJudge!.score]);
  }

  lines.push("| backend | pairs | exact | ±1 | ≥2 | pearson |");
  lines.push("|---------|-------|-------|----|----|---------|");
  for (const [backend, pairs] of byBackend.entries()) {
    const agg = computeJudgeAgreement(pairs);
    lines.push(
      `| ${backend} | ${agg.count} | ${agg.exact} | ${agg.within1} | ${agg.off2plus} | ${fmt(agg.pearson)} |`,
    );
  }
  return lines;
}

function renderSideBySide(runs: JudgedAnswerRun[], questions: ControlQuestion[]): string[] {
  const lines: string[] = ["## Side-by-side examples", ""];
  const questionText = new Map(questions.map((q) => [q.id, q.question]));
  const examples = selectSideBySideExamples(runs, 3);
  if (examples.length === 0) {
    lines.push("_Недостаточно данных для подбора примеров._");
    return lines;
  }
  for (const ex of examples) {
    const qText = questionText.get(ex.questionId) ?? ex.questionId;
    lines.push(`### ${ex.questionId} — ${ex.modeName} (gap ${ex.gap.toFixed(2)})`);
    lines.push("");
    lines.push(`**Question**: ${qText}`);
    lines.push("");
    const byBackend = groupByBackend(ex.runs);
    for (const [backend, group] of byBackend.entries()) {
      lines.push(`#### ${backend} backend`);
      lines.push("");
      for (const r of group) {
        const cJ = r.cloudJudge ? `C=${r.cloudJudge.score}` : "C=—";
        const lJ = r.localJudge ? `L=${r.localJudge.score}` : "L=—";
        lines.push(`run ${r.runIndex} · ${cJ} · ${lJ} · ${r.latencyMs}ms${r.error ? ` · ERR ${r.errorClass ?? "?"}` : ""}`);
        lines.push("");
        if (r.answer) {
          lines.push("```");
          lines.push(r.answer);
          lines.push("```");
          lines.push("");
        }
        if (r.cloudJudge?.verdict) {
          lines.push(`**Cloud judge verdict**: ${r.cloudJudge.verdict}`);
          lines.push("");
        }
        if (r.localJudge?.verdict) {
          lines.push(`**Local judge verdict**: ${r.localJudge.verdict}`);
          lines.push("");
        }
      }
    }
  }
  return lines;
}

function groupByBackend(runs: JudgedAnswerRun[]): Map<string, JudgedAnswerRun[]> {
  const out = new Map<string, JudgedAnswerRun[]>();
  for (const r of runs) {
    if (!out.has(r.backendName)) out.set(r.backendName, []);
    out.get(r.backendName)!.push(r);
  }
  return out;
}

function renderImpressionsPlaceholder(): string[] {
  return [
    "## Что удивило / где local уступил / где не уступил",
    "",
    "<!-- заполняется вручную после прогона -->",
    "",
    "TODO по факту прогона:",
    "",
    "- Время Phase 2 (локальная генерация) / Phase 3 (judge).",
    "- Наблюдения по VRAM-давлению Ollama (смотри sequential latency).",
    "- Где local 3B-4B уступил cloud (конкретные вопросы/режимы).",
    "- Где local не уступил или выиграл.",
    "- Dual-judge bias: насколько cloud и local судьи согласны.",
    "- Характер ошибок (если были).",
    "- Next steps.",
  ];
}

function fmt(v: number | null): string {
  if (v === null) return EM_DASH;
  if (Number.isInteger(v)) return v.toString();
  return v.toFixed(2);
}

function fmtMs(v: number | null): string {
  if (v === null) return EM_DASH;
  return Math.round(v).toString();
}

function fmtDiff(a: number | null, b: number | null): string {
  if (a === null || b === null) return EM_DASH;
  const d = b - a;
  const sign = d > 0 ? "+" : "";
  return `${sign}${d.toFixed(2)}`;
}

function escapePipe(text: string): string {
  return text.replace(/\|/g, "\\|");
}
