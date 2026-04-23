import type { JudgedAnswerRun } from "./dual-judge-service";

export type LatencyStats = {
  count: number;
  mean: number | null;
  p50: number | null;
  p95: number | null;
  std: number | null;
  min: number | null;
  max: number | null;
};

export type JudgeAgreement = {
  count: number;
  exact: number;
  within1: number;
  off2plus: number;
  pearson: number | null;
};

export type ModeBackendCell = {
  modeName: string;
  backendName: string;
  total: number;
  successful: number;
  errors: number;
  cloudJudgeAvg: number | null;
  localJudgeAvg: number | null;
  cloudJudgeStd: number | null;
  localJudgeStd: number | null;
  latency: LatencyStats;
};

export type UnstableRow = {
  questionId: string;
  modeName: string;
  backendName: string;
  runs: number;
  meanCloud: number | null;
  stdCloud: number | null;
  meanLocal: number | null;
  stdLocal: number | null;
  meanLatency: number | null;
  stdLatency: number | null;
};

export type SideBySideExample = {
  questionId: string;
  modeName: string;
  runs: JudgedAnswerRun[];
  gap: number;
  reason: string;
};

export function computeLatencyStats(values: number[]): LatencyStats {
  if (values.length === 0) {
    return {
      count: 0,
      mean: null,
      p50: null,
      p95: null,
      std: null,
      min: null,
      max: null,
    };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;
  const sum = sorted.reduce((s, v) => s + v, 0);
  const mean = sum / count;
  const variance =
    sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / count;
  const std = Math.sqrt(variance);
  return {
    count,
    mean,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    std,
    min: sorted[0]!,
    max: sorted[count - 1]!,
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  const idx = Math.max(0, Math.min(sorted.length - 1, rank - 1));
  return sorted[idx]!;
}

export function computeJudgeAgreement(pairs: Array<[number, number]>): JudgeAgreement {
  if (pairs.length === 0) {
    return { count: 0, exact: 0, within1: 0, off2plus: 0, pearson: null };
  }
  let exact = 0;
  let within1 = 0;
  let off2plus = 0;
  for (const [a, b] of pairs) {
    const diff = Math.abs(a - b);
    if (diff === 0) exact += 1;
    else if (diff === 1) within1 += 1;
    else off2plus += 1;
  }
  return {
    count: pairs.length,
    exact,
    within1,
    off2plus,
    pearson: pearsonCorrelation(pairs),
  };
}

function pearsonCorrelation(pairs: Array<[number, number]>): number | null {
  const n = pairs.length;
  if (n === 0) return null;
  let sumA = 0;
  let sumB = 0;
  for (const [a, b] of pairs) {
    sumA += a;
    sumB += b;
  }
  const meanA = sumA / n;
  const meanB = sumB / n;
  let num = 0;
  let denomA = 0;
  let denomB = 0;
  for (const [a, b] of pairs) {
    const da = a - meanA;
    const db = b - meanB;
    num += da * db;
    denomA += da * da;
    denomB += db * db;
  }
  if (denomA === 0 || denomB === 0) return null;
  return num / Math.sqrt(denomA * denomB);
}

export function aggregateByModeBackend(runs: JudgedAnswerRun[]): ModeBackendCell[] {
  const keyOrder: string[] = [];
  const groups = new Map<string, JudgedAnswerRun[]>();
  for (const r of runs) {
    const key = `${r.modeName}\u241E${r.backendName}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      keyOrder.push(key);
    }
    groups.get(key)!.push(r);
  }
  return keyOrder.map((key) => {
    const group = groups.get(key)!;
    const [modeName, backendName] = key.split("\u241E");
    const successful = group.filter((r) => !r.error);
    const errors = group.length - successful.length;
    const cloudScores = group
      .map((r) => r.cloudJudge?.score)
      .filter((s): s is number => typeof s === "number");
    const localScores = group
      .map((r) => r.localJudge?.score)
      .filter((s): s is number => typeof s === "number");
    return {
      modeName: modeName!,
      backendName: backendName!,
      total: group.length,
      successful: successful.length,
      errors,
      cloudJudgeAvg: mean(cloudScores),
      localJudgeAvg: mean(localScores),
      cloudJudgeStd: std(cloudScores),
      localJudgeStd: std(localScores),
      latency: computeLatencyStats(successful.map((r) => r.latencyMs)),
    };
  });
}

export function findTopUnstable(
  runs: JudgedAnswerRun[],
  by: "judge" | "latency",
  topN: number,
): UnstableRow[] {
  const groups = new Map<string, JudgedAnswerRun[]>();
  for (const r of runs) {
    const key = `${r.questionId}\u241E${r.modeName}\u241E${r.backendName}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const rows: UnstableRow[] = [];
  for (const [key, group] of groups.entries()) {
    if (group.length < 2) continue;
    const [qId, mode, backend] = key.split("\u241E");
    const cloudScores = group
      .map((r) => r.cloudJudge?.score)
      .filter((s): s is number => typeof s === "number");
    const localScores = group
      .map((r) => r.localJudge?.score)
      .filter((s): s is number => typeof s === "number");
    const successfulLatency = group.filter((r) => !r.error).map((r) => r.latencyMs);
    rows.push({
      questionId: qId!,
      modeName: mode!,
      backendName: backend!,
      runs: group.length,
      meanCloud: mean(cloudScores),
      stdCloud: std(cloudScores),
      meanLocal: mean(localScores),
      stdLocal: std(localScores),
      meanLatency: mean(successfulLatency),
      stdLatency: std(successfulLatency),
    });
  }
  const sortKey = (row: UnstableRow): number => {
    if (by === "judge") {
      const c = row.stdCloud ?? 0;
      const l = row.stdLocal ?? 0;
      return Math.max(c, l);
    }
    return row.stdLatency ?? 0;
  };
  return rows.sort((a, b) => sortKey(b) - sortKey(a)).slice(0, topN);
}

export function selectSideBySideExamples(
  runs: JudgedAnswerRun[],
  topN: number,
): SideBySideExample[] {
  const backendNames = new Set(runs.map((r) => r.backendName));
  if (backendNames.size < 2) return [];

  const byQuestionMode = new Map<string, JudgedAnswerRun[]>();
  for (const r of runs) {
    const key = `${r.questionId}\u241E${r.modeName}`;
    if (!byQuestionMode.has(key)) byQuestionMode.set(key, []);
    byQuestionMode.get(key)!.push(r);
  }

  const examples: SideBySideExample[] = [];
  for (const [key, group] of byQuestionMode.entries()) {
    const [qId, mode] = key.split("\u241E");
    const byBackend = new Map<string, number[]>();
    for (const r of group) {
      const s = r.cloudJudge?.score;
      if (typeof s !== "number") continue;
      if (!byBackend.has(r.backendName)) byBackend.set(r.backendName, []);
      byBackend.get(r.backendName)!.push(s);
    }
    if (byBackend.size < 2) continue;
    const means = Array.from(byBackend.values()).map((xs) => mean(xs) ?? 0);
    const gap = Math.max(...means) - Math.min(...means);
    examples.push({
      questionId: qId!,
      modeName: mode!,
      runs: group,
      gap,
      reason: gap > 0 ? "max gap" : "tie",
    });
  }
  return examples.sort((a, b) => b.gap - a.gap).slice(0, topN);
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function std(values: number[]): number | null {
  if (values.length === 0) return null;
  const m = mean(values)!;
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}
