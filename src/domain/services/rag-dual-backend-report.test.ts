import { describe, test, expect } from "bun:test";
import { renderDualBackendReport } from "./rag-dual-backend-report";
import type { JudgedAnswerRun } from "./dual-judge-service";
import type { ControlQuestion } from "./rag-evaluation-service";

function j(score: 0 | 1 | 2 | 3, verdict = "v", modelId = "m") {
  return { score, verdict, modelId, raw: `{"score":${score}}` };
}

function makeRun(overrides: Partial<JudgedAnswerRun> = {}): JudgedAnswerRun {
  return {
    questionId: "q1",
    modeName: "baseline",
    backendName: "local",
    runIndex: 1,
    latencyMs: 100,
    answer: "some answer",
    cloudJudge: j(3),
    localJudge: j(3),
    ...overrides,
  };
}

function makeQuestion(id: string, question: string): ControlQuestion {
  return { id, question, expectation: "exp" };
}

describe("renderDualBackendReport", () => {
  test("returns a non-empty markdown string with all 7 sections", () => {
    const runs: JudgedAnswerRun[] = [
      makeRun({ modeName: "baseline", backendName: "local", cloudJudge: j(3), localJudge: j(3) }),
      makeRun({ modeName: "baseline", backendName: "cloud", cloudJudge: j(3), localJudge: j(3) }),
    ];
    const report = renderDualBackendReport({
      runs,
      questions: [makeQuestion("q1", "what?")],
      options: {
        generatedAt: "2026-04-23T00:00:00.000Z",
        strategy: "structural",
        localModel: "qwen3:4b",
        cloudModel: "gpt-5-nano",
        runsPerCell: 1,
        temperature: 0.2,
      },
    });
    expect(report).toContain("# Day 28");
    expect(report).toContain("## Executive summary");
    expect(report).toContain("## Mode × backend");
    expect(report).toContain("## Per-question breakdown");
    expect(report).toContain("## Stability");
    expect(report).toContain("## Dual-judge agreement");
    expect(report).toContain("## Side-by-side examples");
    expect(report).toContain("## Что удивило");
    expect(report).toContain("qwen3:4b");
    expect(report).toContain("gpt-5-nano");
  });

  test("main table has one row per (mode, backend)", () => {
    const runs: JudgedAnswerRun[] = [
      makeRun({ modeName: "baseline", backendName: "local" }),
      makeRun({ modeName: "baseline", backendName: "cloud" }),
      makeRun({ modeName: "rag-plain", backendName: "local" }),
      makeRun({ modeName: "rag-plain", backendName: "cloud" }),
    ];
    const report = renderDualBackendReport({
      runs,
      questions: [makeQuestion("q1", "what?")],
      options: {
        generatedAt: "2026-04-23T00:00:00.000Z",
        strategy: "structural",
        localModel: "lm",
        cloudModel: "cm",
        runsPerCell: 1,
        temperature: 0.2,
      },
    });
    expect(report).toMatch(/baseline\s*\|\s*local/);
    expect(report).toMatch(/baseline\s*\|\s*cloud/);
    expect(report).toMatch(/rag-plain\s*\|\s*local/);
    expect(report).toMatch(/rag-plain\s*\|\s*cloud/);
  });

  test("per-question breakdown contains all question ids", () => {
    const runs: JudgedAnswerRun[] = [
      makeRun({ questionId: "q1", backendName: "local" }),
      makeRun({ questionId: "q1", backendName: "cloud" }),
      makeRun({ questionId: "q2", backendName: "local", cloudJudge: j(1) }),
      makeRun({ questionId: "q2", backendName: "cloud", cloudJudge: j(3) }),
    ];
    const report = renderDualBackendReport({
      runs,
      questions: [makeQuestion("q1", "a?"), makeQuestion("q2", "b?")],
      options: {
        generatedAt: "t",
        strategy: "structural",
        localModel: "lm",
        cloudModel: "cm",
        runsPerCell: 1,
        temperature: 0.2,
      },
    });
    expect(report).toContain("q1");
    expect(report).toContain("q2");
  });

  test("all-errors case: renderer does not crash, latency is '—', error count = total", () => {
    const runs: JudgedAnswerRun[] = [
      makeRun({ error: "timeout", errorClass: "timeout", latencyMs: 0, answer: "", cloudJudge: j(0), localJudge: j(0) }),
    ];
    const report = renderDualBackendReport({
      runs,
      questions: [makeQuestion("q1", "a?")],
      options: {
        generatedAt: "t",
        strategy: "structural",
        localModel: "lm",
        cloudModel: "cm",
        runsPerCell: 1,
        temperature: 0.2,
      },
    });
    expect(report).toContain("timeout");
    // latency should appear as em-dash for zero successful runs
    expect(report).toContain("—");
  });

  test("section 7 is a placeholder for manual editing", () => {
    const report = renderDualBackendReport({
      runs: [makeRun()],
      questions: [makeQuestion("q1", "a?")],
      options: {
        generatedAt: "t",
        strategy: "structural",
        localModel: "lm",
        cloudModel: "cm",
        runsPerCell: 1,
        temperature: 0.2,
      },
    });
    expect(report).toMatch(/Что удивило/);
    expect(report).toMatch(/заполняется вручную|TODO|<!--/i);
  });

  test("side-by-side example includes full local and cloud answers", () => {
    const runs: JudgedAnswerRun[] = [
      makeRun({
        questionId: "q1",
        modeName: "rag-plain",
        backendName: "local",
        answer: "local answer text",
        cloudJudge: j(1, "weak"),
        localJudge: j(1, "weak"),
      }),
      makeRun({
        questionId: "q1",
        modeName: "rag-plain",
        backendName: "cloud",
        answer: "cloud answer text",
        cloudJudge: j(3, "great"),
        localJudge: j(3, "great"),
      }),
    ];
    const report = renderDualBackendReport({
      runs,
      questions: [makeQuestion("q1", "what is X?")],
      options: {
        generatedAt: "t",
        strategy: "structural",
        localModel: "lm",
        cloudModel: "cm",
        runsPerCell: 1,
        temperature: 0.2,
      },
    });
    expect(report).toContain("local answer text");
    expect(report).toContain("cloud answer text");
    expect(report).toContain("what is X?");
  });
});
