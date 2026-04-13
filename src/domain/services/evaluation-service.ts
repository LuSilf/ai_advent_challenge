import type { VectorSearchHit } from "../models/chunking";

export type EvalQuery = {
  id: string;
  query: string;
  expected_section_contains?: string[];
  expected_keywords?: string[];
};

export type QueryResult = {
  queryId: string;
  query: string;
  hits: VectorSearchHit[];
  firstHitRank: number; // 1..k, or 0 if no hit matched
};

export type StrategyReport = {
  strategy: string;
  recallAt3: number;
  mrr: number;
  queryResults: QueryResult[];
};

export function isHit(hit: VectorSearchHit, expected: EvalQuery): boolean {
  const sections = expected.expected_section_contains ?? [];
  const keywords = expected.expected_keywords ?? [];

  if (hit.section) {
    const sectionLower = hit.section.toLowerCase();
    for (const s of sections) {
      if (sectionLower.includes(s.toLowerCase())) return true;
    }
  }

  const textLower = hit.text.toLowerCase();
  for (const k of keywords) {
    if (textLower.includes(k.toLowerCase())) return true;
  }

  return false;
}

export function evaluateQuery(hits: VectorSearchHit[], expected: EvalQuery): QueryResult {
  let firstHitRank = 0;
  for (let i = 0; i < hits.length; i++) {
    if (isHit(hits[i]!, expected)) {
      firstHitRank = i + 1;
      break;
    }
  }
  return { queryId: expected.id, query: expected.query, hits, firstHitRank };
}

export function computeRecallAt3(results: QueryResult[]): number {
  if (results.length === 0) return 0;
  const hits = results.filter((r) => r.firstHitRank > 0).length;
  return hits / results.length;
}

export function computeMRR(results: QueryResult[]): number {
  if (results.length === 0) return 0;
  let sum = 0;
  for (const r of results) {
    if (r.firstHitRank > 0) sum += 1 / r.firstHitRank;
  }
  return sum / results.length;
}
