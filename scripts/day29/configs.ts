export type PromptVariant = "soft" | "strict";

export type Day29Config = {
  name: string;
  description: string;
  model: string;
  promptVariant: PromptVariant;
  temperature: number;
  maxCompletionTokens: number;
  numCtx?: number;
};

const BASE_MODEL_Q4 = "qwen3:4b-instruct-2507-q4_K_M";
const BASE_MODEL_Q5 = "qwen3:4b-instruct-2507-q5_K_M";

export const CONFIGS: Record<string, Day29Config> = {
  c0: {
    name: "c0",
    description: "baseline (day28 defaults, soft prompt, q4_K_M)",
    model: BASE_MODEL_Q4,
    promptVariant: "soft",
    temperature: 0.2,
    maxCompletionTokens: 800,
  },
  c1: {
    name: "c1",
    description: "c0 + strict refusal prompt",
    model: BASE_MODEL_Q4,
    promptVariant: "strict",
    temperature: 0.2,
    maxCompletionTokens: 800,
  },
  c2: {
    name: "c2",
    description: "c1 + tight params (temp=0, max=400, num_ctx=8192)",
    model: BASE_MODEL_Q4,
    promptVariant: "strict",
    temperature: 0.0,
    maxCompletionTokens: 400,
    numCtx: 8192,
  },
  c3: {
    name: "c3",
    description: "c2 + q5_K_M quantization",
    model: BASE_MODEL_Q5,
    promptVariant: "strict",
    temperature: 0.0,
    maxCompletionTokens: 400,
    numCtx: 8192,
  },
};

export const DAY29_QUESTION_IDS = ["q03", "q10", "q11_oos", "q12_oos", "q13_oos"];
