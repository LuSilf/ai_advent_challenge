import type { RuleScoredEvaluatedQuestion } from "./rag-rules-scorer";

export function renderRagEvaluationReport(results: RuleScoredEvaluatedQuestion[], options: {
  strategy: string;
  topK: number;
  generatedAt: string;
}): string {
  const lines: string[] = [];
  lines.push("# Day 22 — RAG answer comparison report");
  lines.push("");
  lines.push(`Generated at: ${options.generatedAt}`);
  lines.push(`RAG strategy: **${options.strategy}**`);
  lines.push(`RAG topK: **${options.topK}**`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| # | Question | Baseline cost | RAG cost | Baseline rules | RAG rules | Retrieval | Expected sections |");
  lines.push("|---|----------|---------------|----------|----------------|-----------|-----------|-------------------|");
  for (const item of results) {
    lines.push(
      `| ${item.question.id} | ${escapeMd(item.question.question)} | ${formatCost(item.baseline.costInfo)} | ${formatCost(item.rag.costInfo)} | ${formatRulesSummary(item.baseline.rules)} | ${formatRulesSummary(item.rag.rules)} | ${item.rag.retrieval.status} | ${escapeMd((item.question.expectedSections ?? []).join(", "))} |`,
    );
  }
  lines.push("");

  for (const item of results) {
    lines.push(`## ${item.question.id}: ${item.question.question}`);
    lines.push("");
    lines.push(`**Expectation:** ${item.question.expectation}`);
    lines.push("");
    if (item.question.expectedSections?.length) {
      lines.push(`**Expected sections:** ${item.question.expectedSections.join(", ")}`);
      lines.push("");
    }

    lines.push("### Baseline (without RAG)");
    lines.push("");
    lines.push(`Cost: ${formatCost(item.baseline.costInfo)}`);
    lines.push(`Rules: ${formatRulesSummary(item.baseline.rules)}`);
    lines.push("");
    lines.push(item.baseline.answer || "(empty)");
    lines.push("");
    lines.push(renderRulesDetails(item.baseline.rules));
    lines.push("");

    lines.push("### Retrieval");
    lines.push("");
    lines.push(renderRetrieval(item.rag.retrieval));
    lines.push("");

    lines.push("### RAG answer");
    lines.push("");
    lines.push(`Cost: ${formatCost(item.rag.costInfo)}`);
    lines.push(`Rules: ${formatRulesSummary(item.rag.rules)}`);
    lines.push("");
    lines.push(item.rag.answer || "(empty)");
    lines.push("");
    lines.push(renderRulesDetails(item.rag.rules));
    lines.push("");
  }

  return lines.join("\n") + "\n";
}

function renderRetrieval(result: RuleScoredEvaluatedQuestion["rag"]["retrieval"]): string {
  if (result.status === "no_index") {
    return "- Retrieval unavailable: index for the selected strategy was not found.";
  }
  if (result.status === "no_hits") {
    return `- Retrieval returned no hits (strategy=${result.strategy}, topK=${result.topK}).`;
  }

  const lines: string[] = [];
  lines.push(`- Retrieved ${result.hits.length} chunk(s) (strategy=${result.strategy}, topK=${result.topK})`);
  for (const [index, hit] of result.hits.entries()) {
    lines.push(`  ${index + 1}. source=${hit.source}; section=${hit.section ?? "(none)"}; distance=${hit.distance.toFixed(4)}`);
  }
  return lines.join("\n");
}

function formatCost(costInfo: { cost: number; inputTokens: number; outputTokens: number } | null): string {
  if (!costInfo) return "—";
  const amount = costInfo.cost < 0.01 ? costInfo.cost.toFixed(6) : costInfo.cost.toFixed(4);
  return `$${amount} (${costInfo.inputTokens}/${costInfo.outputTokens})`;
}

function formatRulesSummary(rules: RuleScoredEvaluatedQuestion["baseline"]["rules"]): string {
  return `${rules.score}/${rules.maxScore} (${rules.verdict})`;
}

function renderRulesDetails(rules: RuleScoredEvaluatedQuestion["baseline"]["rules"]): string {
  const lines = [
    `- Rule score: ${rules.score}/${rules.maxScore}`,
    `- Verdict: ${rules.verdict}`,
  ];
  if (rules.matchedMustInclude.length > 0) {
    lines.push(`- Matched must-have: ${rules.matchedMustInclude.join(", ")}`);
  }
  if (rules.missedMustInclude.length > 0) {
    lines.push(`- Missed must-have: ${rules.missedMustInclude.join(", ")}`);
  }
  if (rules.matchedNiceToHave.length > 0) {
    lines.push(`- Matched nice-to-have: ${rules.matchedNiceToHave.join(", ")}`);
  }
  if (rules.matchedSections.length > 0) {
    lines.push(`- Matched sections: ${rules.matchedSections.join(", ")}`);
  }
  return lines.join("\n");
}

function escapeMd(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
