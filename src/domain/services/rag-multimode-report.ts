import type { CostInfo } from "../models";
import type { ControlQuestion } from "./rag-evaluation-service";
import type { JudgeScore } from "./rag-judge-service";
import type { RulesScore } from "./rag-rules-scorer";
import type { PipelineRetrieveResult, RankedHit } from "./rag-pipeline-service";

export type ModeResult = {
  modeName: string;
  answer: string;
  costInfo: CostInfo | null;
  rules: RulesScore;
  judge: JudgeScore;
  retrieval?: PipelineRetrieveResult;
};

export type MultiModeQuestionResult = {
  question: ControlQuestion;
  baseline: ModeResult;
  modes: ModeResult[];
};

export type ReportOptions = {
  generatedAt: string;
  strategy: string;
};

export function renderMultiModeReport(
  results: MultiModeQuestionResult[],
  options: ReportOptions,
): string {
  const lines: string[] = [];
  lines.push("# Day 23 — RAG reranking & filtering comparison report");
  lines.push("");
  lines.push(`Generated at: ${options.generatedAt}`);
  lines.push(`Strategy: **${options.strategy}**`);
  lines.push("");

  lines.push(...renderSummary(results));
  lines.push("");

  lines.push("## Per-question summary");
  lines.push("");
  lines.push(renderSummaryTable(results));
  lines.push("");

  for (const result of results) {
    lines.push(...renderQuestionDetail(result));
    lines.push("");
  }

  return lines.join("\n") + "\n";
}

function renderSummary(results: MultiModeQuestionResult[]): string[] {
  const lines: string[] = [];
  lines.push("## Mode comparison summary");
  lines.push("");

  const allModeNames = ["baseline", ...new Set(results.flatMap((r) => r.modes.map((m) => m.modeName)))];

  lines.push("| Mode | Avg judge | Avg cost | Wins vs baseline |");
  lines.push("|------|-----------|----------|------------------|");

  for (const modeName of allModeNames) {
    const scores: number[] = [];
    const costs: number[] = [];
    let winsVsBaseline = 0;

    for (const result of results) {
      if (modeName === "baseline") {
        scores.push(result.baseline.judge.score);
        costs.push(result.baseline.costInfo?.cost ?? 0);
      } else {
        const modeResult = result.modes.find((m) => m.modeName === modeName);
        if (modeResult) {
          scores.push(modeResult.judge.score);
          costs.push(modeResult.costInfo?.cost ?? 0);
          if (modeResult.judge.score > result.baseline.judge.score) winsVsBaseline++;
        }
      }
    }

    const avgScore = scores.length > 0 ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : "—";
    const avgCost = costs.length > 0 ? `$${(costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(6)}` : "—";
    const winsStr = modeName === "baseline" ? "—" : `${winsVsBaseline}/${results.length}`;

    lines.push(`| ${modeName} | ${avgScore}/3 | ${avgCost} | ${winsStr} |`);
  }

  return lines;
}

function renderSummaryTable(results: MultiModeQuestionResult[]): string {
  const allModeNames = ["baseline", ...new Set(results.flatMap((r) => r.modes.map((m) => m.modeName)))];
  const header = `| # | Question | ${allModeNames.map((m) => `${m} judge`).join(" | ")} |`;
  const separator = `|---|----------|${allModeNames.map(() => "---").join("|")}|`;
  const rows = results.map((r) => {
    const scores = allModeNames.map((modeName) => {
      if (modeName === "baseline") return `${r.baseline.judge.score}/3`;
      const mode = r.modes.find((m) => m.modeName === modeName);
      return mode ? `${mode.judge.score}/3` : "—";
    });
    return `| ${r.question.id} | ${escapeMd(r.question.question)} | ${scores.join(" | ")} |`;
  });

  return [header, separator, ...rows].join("\n");
}

function renderQuestionDetail(result: MultiModeQuestionResult): string[] {
  const lines: string[] = [];
  lines.push(`## ${result.question.id}: ${result.question.question}`);
  lines.push("");
  lines.push(`**Expectation:** ${result.question.expectation}`);
  lines.push("");
  if (result.question.expectedSections?.length) {
    lines.push(`**Expected sections:** ${result.question.expectedSections.join(", ")}`);
    lines.push("");
  }

  lines.push("### Baseline");
  lines.push("");
  lines.push(`Cost: ${formatCost(result.baseline.costInfo)}`);
  lines.push(`Rules: ${result.baseline.rules.score}/${result.baseline.rules.maxScore} (${result.baseline.rules.verdict})`);
  lines.push(`Judge: ${result.baseline.judge.score}/3 — ${result.baseline.judge.verdict}`);
  lines.push("");

  for (const mode of result.modes) {
    lines.push(`### ${mode.modeName}`);
    lines.push("");
    lines.push(`Cost: ${formatCost(mode.costInfo)}`);
    lines.push(`Rules: ${mode.rules.score}/${mode.rules.maxScore} (${mode.rules.verdict})`);
    lines.push(`Judge: ${mode.judge.score}/3 — ${mode.judge.verdict}`);
    lines.push("");

    if (mode.retrieval) {
      if (mode.retrieval.rewrittenQuery) {
        lines.push(`**Rewritten query:** ${mode.retrieval.rewrittenQuery}`);
        lines.push("");
      }

      lines.push(`**Retrieval:** ${mode.retrieval.status} (${mode.retrieval.hitsBeforeFilter} candidates → ${mode.retrieval.hits.length} final)`);
      lines.push("");

      if (mode.retrieval.thresholdFilter) {
        lines.push(`Threshold filtered: ${mode.retrieval.thresholdFilter.rejected.length} rejected`);
        for (const hit of mode.retrieval.thresholdFilter.rejected) {
          lines.push(`  - section=${hit.section ?? "(none)"}; distance=${hit.distance.toFixed(4)}`);
        }
        lines.push("");
      }

      if (mode.retrieval.rerankedHits) {
        lines.push("Reranker scores:");
        for (const hit of mode.retrieval.rerankedHits as RankedHit[]) {
          lines.push(`  - section=${hit.section ?? "(none)"}; distance=${hit.distance.toFixed(4)}; relevance=${hit.relevanceScore.toFixed(2)}`);
        }
        lines.push("");
      }

      if (mode.retrieval.hits.length > 0) {
        lines.push("Final chunks:");
        for (const [i, hit] of mode.retrieval.hits.entries()) {
          lines.push(`  ${i + 1}. section=${hit.section ?? "(none)"}; distance=${hit.distance.toFixed(4)}`);
        }
        lines.push("");
      }
    }
  }

  return lines;
}

function formatCost(costInfo: CostInfo | null): string {
  if (!costInfo) return "—";
  const amount = costInfo.cost < 0.01 ? costInfo.cost.toFixed(6) : costInfo.cost.toFixed(4);
  return `$${amount} (${costInfo.inputTokens}/${costInfo.outputTokens})`;
}

function escapeMd(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
