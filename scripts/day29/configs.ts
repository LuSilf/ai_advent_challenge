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
// Ollama registry для qwen3:4b-instruct-2507 даёт только q4/q8/fp16 (нет q5/q6).
// q8_0 = 4.3 GB > 4 GB VRAM → partial CPU offload неизбежен.
// Это честный trade-off «больше квантов = медленнее», фиксируем как есть.
const BASE_MODEL_Q_HIGH = "qwen3:4b-instruct-2507-q8_0";

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
    description: "c2 + q8_0 quantization (registry даёт только q4/q8/fp16)",
    model: BASE_MODEL_Q_HIGH,
    promptVariant: "strict",
    temperature: 0.0,
    maxCompletionTokens: 400,
    numCtx: 8192,
  },
};

export const DAY29_QUESTION_IDS = ["q03", "q10", "q11_oos", "q12_oos", "q13_oos"];
