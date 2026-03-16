const DEFAULT_TIMEOUT_MS = 30_000;

const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;

type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
type ReasoningSummaryMode = "auto" | "concise" | "detailed";

export type AppConfig = {
  prompt: string;
  apiKey: string;
  model: string;
  baseUrl: string;
  systemPrompt: string;
  effectiveTimeoutMs: number;
  debug: boolean;
  useStreaming: boolean;
  reasoningEffort?: ReasoningEffort;
  reasoningSummary?: ReasoningSummaryMode;
  temperature?: number;
  topP?: number;
  n?: number;
  maxCompletionTokens?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
};

const DEFAULT_SYSTEM_PROMPT = `You are a poetic assistant.
All responses must be written as poetry in Russian.

Poetry specification:

Language: Russian
Poetic form: two quatrains (2 stanzas, 4 lines each)
Meter: iambic tetrameter
Rhyme scheme: ABAB
Line length: approximately 8-9 syllables
Rhythm: strict and consistent
Style: humorous
Lexicon: elevated / high literary vocabulary

Rules:

* The response must contain exactly two quatrains.
* Maintain a clear rhyme scheme ABAB in each quatrain.
* Preserve a consistent iambic rhythm across lines.
* Use humorous imagery or witty tone.
* Use elevated vocabulary and literary expressions.
* Do not include prose explanations or commentary.
* If the structure or rhythm breaks, rewrite the poem internally before answering.`;

function getEnv(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function parseNumberEnv(name: string, fail: (message: string) => never): number | undefined {
  const value = getEnv(name);
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    fail(`Invalid ${name} value: ${value}. Must be a finite number`);
  }

  return parsed;
}

function parseBooleanEnv(name: string, defaultValue: boolean, fail: (message: string) => never): boolean {
  const value = getEnv(name);
  if (!value) {
    return defaultValue;
  }

  const normalized = value.toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }

  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }

  fail(`Invalid ${name} value: ${value}. Use 1|0|true|false|yes|no|on|off`);
}

function parseIntegerEnv(name: string, fail: (message: string) => never): number | undefined {
  const parsed = parseNumberEnv(name, fail);
  if (parsed === undefined) {
    return undefined;
  }

  if (!Number.isInteger(parsed)) {
    fail(`Invalid ${name} value: ${parsed}. Must be an integer`);
  }

  return parsed;
}

function parseBoundedNumber(name: string, min: number, max: number, fail: (message: string) => never): number | undefined {
  const parsed = parseNumberEnv(name, fail);
  if (parsed === undefined) {
    return undefined;
  }

  if (parsed < min || parsed > max) {
    fail(`Invalid ${name} value: ${parsed}. Must be between ${min} and ${max}`);
  }

  return parsed;
}

function parseMinInteger(name: string, min: number, fail: (message: string) => never): number | undefined {
  const parsed = parseIntegerEnv(name, fail);
  if (parsed === undefined) {
    return undefined;
  }

  if (parsed < min) {
    fail(`Invalid ${name} value: ${parsed}. Must be >= ${min}`);
  }

  return parsed;
}

function parseReasoningEffort(rawValue: string | undefined, fail: (message: string) => never): ReasoningEffort | undefined {
  if (!rawValue) {
    return undefined;
  }

  const normalized = rawValue.toLowerCase();
  if ((REASONING_EFFORTS as readonly string[]).includes(normalized)) {
    return normalized as ReasoningEffort;
  }

  fail(`Invalid OPENAI_REASONING_EFFORT value: ${rawValue}. Use none|minimal|low|medium|high|xhigh`);
}

function parseReasoningSummary(rawValue: string | undefined, fail: (message: string) => never): ReasoningSummaryMode | undefined {
  if (!rawValue) {
    return undefined;
  }

  const normalized = rawValue.toLowerCase();
  if (normalized === "auto" || normalized === "concise" || normalized === "detailed") {
    return normalized;
  }

  fail(`Invalid OPENAI_REASONING_SUMMARY value: ${rawValue}. Use auto|concise|detailed`);
}

export function loadConfig(rawPrompt: string, fail: (message: string) => never): AppConfig {
  const prompt = rawPrompt.trim();
  if (!prompt) {
    fail('Usage: bun run src/cli.ts "Your prompt"');
  }

  const apiKeyEnvName = getEnv("OPENAI_API_KEY_ENV");
  const apiKey = getEnv("OPENAI_API_KEY") || (apiKeyEnvName ? getEnv(apiKeyEnvName) : undefined);
  const model = getEnv("OPENAI_MODEL");

  if (!apiKey) {
    fail("Missing API key. Set OPENAI_API_KEY or OPENAI_API_KEY_ENV");
  }

  if (!model) {
    fail("Missing OPENAI_MODEL environment variable");
  }

  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS ?? String(DEFAULT_TIMEOUT_MS));

  return {
    prompt,
    apiKey,
    model,
    baseUrl: (getEnv("OPENAI_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/$/, ""),
    systemPrompt: process.env.OPENAI_SYSTEM_PROMPT ?? DEFAULT_SYSTEM_PROMPT,
    effectiveTimeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
    debug: parseBooleanEnv("OPENAI_DEBUG", false, fail),
    useStreaming: parseBooleanEnv("OPENAI_STREAM", true, fail),
    reasoningEffort: parseReasoningEffort(getEnv("OPENAI_REASONING_EFFORT"), fail),
    reasoningSummary: parseReasoningSummary(getEnv("OPENAI_REASONING_SUMMARY"), fail),
    temperature: parseBoundedNumber("OPENAI_TEMPERATURE", 0, 2, fail),
    topP: parseBoundedNumber("OPENAI_TOP_P", 0, 1, fail),
    n: parseMinInteger("OPENAI_N", 1, fail),
    maxCompletionTokens: parseMinInteger("OPENAI_MAX_COMPLETION_TOKENS", 1, fail),
    presencePenalty: parseBoundedNumber("OPENAI_PRESENCE_PENALTY", -2, 2, fail),
    frequencyPenalty: parseBoundedNumber("OPENAI_FREQUENCY_PENALTY", -2, 2, fail)
  };
}
