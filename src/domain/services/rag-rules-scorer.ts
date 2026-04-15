import type { EvaluatedQuestion } from "./rag-evaluation-service";
import type { RagRetrieveResult } from "./rag-service";

export type RulesScore = {
  score: number;
  maxScore: number;
  matchedMustInclude: string[];
  missedMustInclude: string[];
  matchedNiceToHave: string[];
  matchedSections: string[];
  verdict: "strong" | "good" | "partial" | "weak";
};

export type RuleScoredEvaluatedQuestion = Omit<EvaluatedQuestion, "baseline" | "rag"> & {
  baseline: EvaluatedQuestion["baseline"] & { rules: RulesScore };
  rag: EvaluatedQuestion["rag"] & { rules: RulesScore };
};

export function attachRuleScores(results: EvaluatedQuestion[]): RuleScoredEvaluatedQuestion[] {
  return results.map((result) => ({
    ...result,
    baseline: {
      ...result.baseline,
      rules: scoreAnswer(result.question, result.baseline.answer),
    },
    rag: {
      ...result.rag,
      rules: scoreAnswer(result.question, result.rag.answer, result.rag.retrieval),
    },
  }));
}

export function scoreAnswer(
  question: EvaluatedQuestion["question"],
  answer: string,
  retrieval?: RagRetrieveResult,
): RulesScore {
  const mustInclude = question.mustInclude ?? [];
  const niceToHave = question.niceToHave ?? [];
  const expectedSections = question.expectedSections ?? [];

  const matchedMustInclude = mustInclude.filter((term) => matchesTerm(answer, term));
  const matchedNiceToHave = niceToHave.filter((term) => matchesTerm(answer, term));
  const missedMustInclude = mustInclude.filter((term) => !matchesTerm(answer, term));
  const matchedSections = retrieval?.status === "ok"
    ? expectedSections.filter((section) => retrieval.hits.some((hit) => matchesTerm(hit.section ?? "", section)))
    : [];

  const sectionBonus = expectedSections.length > 0 && retrieval ? 1 : 0;
  const maxScore = mustInclude.length * 2 + niceToHave.length + sectionBonus;
  const score = matchedMustInclude.length * 2 + matchedNiceToHave.length + (matchedSections.length > 0 ? sectionBonus : 0);

  return {
    score,
    maxScore,
    matchedMustInclude,
    missedMustInclude,
    matchedNiceToHave,
    matchedSections,
    verdict: buildVerdict(mustInclude.length, matchedMustInclude.length, niceToHave.length, matchedNiceToHave.length, matchedSections.length, expectedSections.length, retrieval),
  };
}

function matchesTerm(text: string, token: string): boolean {
  return expandAlternatives(token).some((variant) => text.toLowerCase().includes(variant.toLowerCase()));
}

function expandAlternatives(token: string): string[] {
  return token
    .split("||")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function buildVerdict(
  mustTotal: number,
  matchedMust: number,
  niceTotal: number,
  matchedNice: number,
  matchedSections: number,
  expectedSectionsTotal: number,
  retrieval?: RagRetrieveResult,
): RulesScore["verdict"] {
  const sectionsSatisfied = expectedSectionsTotal === 0 || !retrieval || matchedSections > 0;
  if (matchedMust === mustTotal && sectionsSatisfied) {
    return "strong";
  }
  if (matchedMust === mustTotal) {
    return "good";
  }
  if (matchedMust > 0 || matchedNice > 0 || matchedSections > 0) {
    return "partial";
  }
  return "weak";
}
