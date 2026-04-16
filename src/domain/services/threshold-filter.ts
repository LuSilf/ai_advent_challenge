import type { VectorSearchHit } from "../models/chunking";

export type ThresholdFilterResult = {
  accepted: VectorSearchHit[];
  rejected: VectorSearchHit[];
};

export function filterByThreshold(
  hits: VectorSearchHit[],
  maxDistance: number,
): ThresholdFilterResult {
  const accepted: VectorSearchHit[] = [];
  const rejected: VectorSearchHit[] = [];

  for (const hit of hits) {
    if (hit.distance <= maxDistance) {
      accepted.push(hit);
    } else {
      rejected.push(hit);
    }
  }

  return { accepted, rejected };
}
