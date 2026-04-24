export type Day29Part2Config = {
  name: string;
  description: string;
  model: string;
  temperature: number;
  maxCompletionTokens: number;
  gatingThreshold: number | null;
};

const MODEL_Q4 = "qwen3:4b-instruct-2507-q4_K_M";

export const PART2_CONFIGS: Record<string, Day29Part2Config> = {
  d0: {
    name: "d0",
    description: "baseline (no gating, soft prompt, q4_K_M) — control, as part1 C0 but with q12b",
    model: MODEL_Q4,
    temperature: 0.2,
    maxCompletionTokens: 800,
    gatingThreshold: null,
  },
  d1: {
    name: "d1",
    description: "retrieval-gating, threshold=0.3 (soft)",
    model: MODEL_Q4,
    temperature: 0.2,
    maxCompletionTokens: 800,
    gatingThreshold: 0.3,
  },
  d2: {
    name: "d2",
    description: "retrieval-gating, threshold=0.5 (main candidate)",
    model: MODEL_Q4,
    temperature: 0.2,
    maxCompletionTokens: 800,
    gatingThreshold: 0.5,
  },
  d3: {
    name: "d3",
    description: "retrieval-gating, threshold=0.7 (aggressive)",
    model: MODEL_Q4,
    temperature: 0.2,
    maxCompletionTokens: 800,
    gatingThreshold: 0.7,
  },
};

export const PART2_QUESTION_IDS = ["q03", "q10", "q11_oos", "q12b_oos", "q13_oos"];
