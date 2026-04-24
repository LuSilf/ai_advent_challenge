import { describe, test, expect } from "bun:test";
import {
  computeLatencyStats,
  computeJudgeAgreement,
  aggregateByModeBackend,
  findTopUnstable,
  selectSideBySideExamples,
} from "./rag-dual-backend-stats";
import type { JudgedAnswerRun } from "./dual-judge-service";

function makeJudged(overrides: Partial<JudgedAnswerRun> = {}): JudgedAnswerRun {
  return {
    questionId: "q1",
    modeName: "rag-plain",
    backendName: "local",
    runIndex: 1,
    latencyMs: 1000,
    answer: "some answer",
    ...overrides,
  };
}

function j(score: 0 | 1 | 2 | 3) {
  return {
    score,
    verdict: "v",
    modelId: "m",
    raw: `{"score":${score},"verdict":"v"}`,
  };
}

describe("computeLatencyStats", () => {
  test("empty array returns zero-count null stats", () => {
    const s = computeLatencyStats([]);
    expect(s.count).toBe(0);
    expect(s.mean).toBeNull();
    expect(s.p50).toBeNull();
    expect(s.p95).toBeNull();
    expect(s.std).toBeNull();
    expect(s.min).toBeNull();
    expect(s.max).toBeNull();
  });

  test("single element: everything equals the value, std=0", () => {
    const s = computeLatencyStats([500]);
    expect(s.count).toBe(1);
    expect(s.mean).toBe(500);
    expect(s.p50).toBe(500);
    expect(s.p95).toBe(500);
    expect(s.std).toBe(0);
    expect(s.min).toBe(500);
    expect(s.max).toBe(500);
  });

  test("three elements [100, 200, 300]: mean=200, std via population formula", () => {
    const s = computeLatencyStats([100, 200, 300]);
    expect(s.count).toBe(3);
    expect(s.mean).toBe(200);
    expect(s.min).toBe(100);
    expect(s.max).toBe(300);
    // population std: sqrt(((100-200)^2 + 0 + (300-200)^2) / 3) = sqrt(20000/3) ≈ 81.65
    expect(s.std).toBeCloseTo(81.65, 1);
  });

  test("ten elements: p50 and p95 via nearest-rank", () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const s = computeLatencyStats(values);
    expect(s.count).toBe(10);
    expect(s.mean).toBe(55);
    expect(s.min).toBe(10);
    expect(s.max).toBe(100);
    expect(s.p50).toBe(50);
    expect(s.p95).toBe(100);
  });
});

describe("computeJudgeAgreement", () => {
  test("empty pairs", () => {
    const a = computeJudgeAgreement([]);
    expect(a.count).toBe(0);
    expect(a.exact).toBe(0);
    expect(a.within1).toBe(0);
    expect(a.off2plus).toBe(0);
    expect(a.pearson).toBeNull();
  });

  test("all pairs equal: exact=N, pearson undefined when variance is zero", () => {
    const a = computeJudgeAgreement([[3, 3], [3, 3], [3, 3]]);
    expect(a.exact).toBe(3);
    expect(a.within1).toBe(0);
    expect(a.off2plus).toBe(0);
    expect(a.pearson).toBeNull();
  });

  test("all pairs differ by 1: within1=N", () => {
    const a = computeJudgeAgreement([[3, 2], [2, 1], [1, 0]]);
    expect(a.exact).toBe(0);
    expect(a.within1).toBe(3);
    expect(a.off2plus).toBe(0);
  });

  test("mixed pairs: bucketing and pearson", () => {
    const pairs: Array<[number, number]> = [
      [3, 3], // exact
      [2, 2], // exact
      [3, 2], // within1
      [1, 3], // off2plus (diff 2)
      [0, 3], // off2plus (diff 3)
    ];
    const a = computeJudgeAgreement(pairs);
    expect(a.count).toBe(5);
    expect(a.exact).toBe(2);
    expect(a.within1).toBe(1);
    expect(a.off2plus).toBe(2);
    expect(a.pearson).not.toBeNull();
    // Strongly anti-correlated (last 2 pairs pull it down), so pearson should be negative or near zero
    expect(a.pearson!).toBeLessThan(0.5);
  });

  test("perfect positive correlation", () => {
    const pairs: Array<[number, number]> = [[0, 0], [1, 1], [2, 2], [3, 3]];
    const a = computeJudgeAgreement(pairs);
    expect(a.pearson).toBeCloseTo(1, 5);
  });
});

describe("aggregateByModeBackend", () => {
  test("one cell per (mode, backend); latency from successful runs only; errors counted separately", () => {
    const runs: JudgedAnswerRun[] = [
      makeJudged({ modeName: "baseline", backendName: "local", latencyMs: 100, cloudJudge: j(2), localJudge: j(2) }),
      makeJudged({ modeName: "baseline", backendName: "local", latencyMs: 200, cloudJudge: j(3), localJudge: j(3) }),
      makeJudged({ modeName: "baseline", backendName: "local", latencyMs: 500, error: "x", errorClass: "timeout", cloudJudge: j(0), localJudge: j(0) }),
      makeJudged({ modeName: "baseline", backendName: "cloud", latencyMs: 50, cloudJudge: j(3), localJudge: j(3) }),
      makeJudged({ modeName: "rag-plain", backendName: "local", latencyMs: 300, cloudJudge: j(2), localJudge: j(1) }),
    ];
    const cells = aggregateByModeBackend(runs);
    expect(cells).toHaveLength(3);
    const baseLocal = cells.find((c) => c.modeName === "baseline" && c.backendName === "local")!;
    expect(baseLocal.total).toBe(3);
    expect(baseLocal.errors).toBe(1);
    expect(baseLocal.latency.count).toBe(2); // only successful
    expect(baseLocal.latency.mean).toBe(150);
    expect(baseLocal.cloudJudgeAvg).toBeCloseTo(5 / 3, 2); // includes 0 from failed? No: judges run only if non-failed? Check below
  });

  test("judge avg includes all runs that have a score (failed runs may or may not)", () => {
    const runs: JudgedAnswerRun[] = [
      makeJudged({ cloudJudge: j(3), localJudge: j(2) }),
      makeJudged({ cloudJudge: j(1), localJudge: j(0) }),
    ];
    const cells = aggregateByModeBackend(runs);
    expect(cells[0]!.cloudJudgeAvg).toBe(2);
    expect(cells[0]!.localJudgeAvg).toBe(1);
  });

  test("cell ordering is stable (by first appearance)", () => {
    const runs: JudgedAnswerRun[] = [
      makeJudged({ modeName: "b", backendName: "l" }),
      makeJudged({ modeName: "a", backendName: "l" }),
      makeJudged({ modeName: "b", backendName: "c" }),
    ];
    const cells = aggregateByModeBackend(runs);
    expect(cells.map((c) => `${c.modeName}/${c.backendName}`)).toEqual(["b/l", "a/l", "b/c"]);
  });
});

describe("findTopUnstable", () => {
  test("returns top-N by std judge across (question, mode, backend) triples", () => {
    const runs: JudgedAnswerRun[] = [
      // stable triple: all 3/3
      makeJudged({ questionId: "q1", runIndex: 1, cloudJudge: j(3), localJudge: j(3) }),
      makeJudged({ questionId: "q1", runIndex: 2, cloudJudge: j(3), localJudge: j(3) }),
      makeJudged({ questionId: "q1", runIndex: 3, cloudJudge: j(3), localJudge: j(3) }),
      // unstable triple: 0 / 3 / 0
      makeJudged({ questionId: "q2", runIndex: 1, cloudJudge: j(0), localJudge: j(0) }),
      makeJudged({ questionId: "q2", runIndex: 2, cloudJudge: j(3), localJudge: j(3) }),
      makeJudged({ questionId: "q2", runIndex: 3, cloudJudge: j(0), localJudge: j(0) }),
    ];
    const top = findTopUnstable(runs, "judge", 1);
    expect(top).toHaveLength(1);
    expect(top[0]!.questionId).toBe("q2");
    expect(top[0]!.stdCloud).toBeGreaterThan(0);
  });

  test("latency variant: returns top-N by std latency", () => {
    const runs: JudgedAnswerRun[] = [
      makeJudged({ questionId: "q1", runIndex: 1, latencyMs: 100 }),
      makeJudged({ questionId: "q1", runIndex: 2, latencyMs: 100 }),
      makeJudged({ questionId: "q2", runIndex: 1, latencyMs: 100 }),
      makeJudged({ questionId: "q2", runIndex: 2, latencyMs: 5000 }),
    ];
    const top = findTopUnstable(runs, "latency", 1);
    expect(top[0]!.questionId).toBe("q2");
    expect(top[0]!.stdLatency).toBeGreaterThan(0);
  });

  test("skips triples with fewer than 2 runs (no variance to compute)", () => {
    const runs: JudgedAnswerRun[] = [
      makeJudged({ questionId: "q1", runIndex: 1, cloudJudge: j(3), localJudge: j(3) }),
    ];
    const top = findTopUnstable(runs, "judge", 5);
    expect(top).toHaveLength(0);
  });
});

describe("selectSideBySideExamples", () => {
  test("picks max-gap (question, mode) between local and cloud backend", () => {
    const runs: JudgedAnswerRun[] = [
      // q1: local avg 1, cloud avg 3 → gap 2
      makeJudged({ questionId: "q1", backendName: "local", cloudJudge: j(1) }),
      makeJudged({ questionId: "q1", backendName: "cloud", cloudJudge: j(3) }),
      // q2: local avg 3, cloud avg 3 → gap 0
      makeJudged({ questionId: "q2", backendName: "local", cloudJudge: j(3) }),
      makeJudged({ questionId: "q2", backendName: "cloud", cloudJudge: j(3) }),
    ];
    const examples = selectSideBySideExamples(runs, 1);
    expect(examples).toHaveLength(1);
    expect(examples[0]!.questionId).toBe("q1");
  });

  test("returns empty when fewer than 2 backends available", () => {
    const runs: JudgedAnswerRun[] = [
      makeJudged({ questionId: "q1", backendName: "local", cloudJudge: j(1) }),
    ];
    const examples = selectSideBySideExamples(runs, 3);
    expect(examples).toHaveLength(0);
  });
});
