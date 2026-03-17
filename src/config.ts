const DEFAULT_TIMEOUT_MS = 30_000;

export const REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;
export const REASONING_SUMMARIES = ["auto", "concise", "detailed"] as const;

type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
type ReasoningSummaryMode = (typeof REASONING_SUMMARIES)[number];

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
  maxCompletionTokens?: number;
};

export type ConfigInputValues = {
  prompt?: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  systemPrompt?: string;
  timeoutMs?: string;
  debug?: string;
  useStreaming?: string;
  reasoningEffort?: string;
  reasoningSummary?: string;
  temperature?: string;
  topP?: string;
  maxCompletionTokens?: string;
};

const DEFAULT_SYSTEM_PROMPT = `
  You are a poetic assistant.

  Always answer in Russian verse.

  Poetry parameters:

  * Stanza type: quatrain
  * Number of stanzas: 2
  * Meter: iambic tetrameter
  * Rhyme scheme: ABAB
  * Rhythm: strict
  * Style: humorous
  * Lexicon: elevated literary language

  Rules:

  * Each stanza must contain exactly four lines.
  * Follow the rhyme scheme and meter as closely as possible.
  * Do not add explanations or prose.
  * Output only the poem.

`;

function trimToUndefined(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getEnv(name: string): string | undefined {
  return trimToUndefined(process.env[name]);
}

function getRawEnv(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined ? undefined : value;
}

function parseNumber(
  rawValue: string | undefined,
  name: string,
  fail: (message: string) => never,
): number | undefined {
  const value = trimToUndefined(rawValue);
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    fail(`Invalid ${name} value: ${value}. Must be a finite number`);
  }

  return parsed;
}

function parseBoolean(
  rawValue: string | undefined,
  name: string,
  defaultValue: boolean,
  fail: (message: string) => never,
): boolean {
  const value = trimToUndefined(rawValue);
  if (!value) {
    return defaultValue;
  }

  const normalized = value.toLowerCase();
  if (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  ) {
    return true;
  }

  if (
    normalized === "0" ||
    normalized === "false" ||
    normalized === "no" ||
    normalized === "off"
  ) {
    return false;
  }

  fail(`Invalid ${name} value: ${value}. Use 1|0|true|false|yes|no|on|off`);
}

function normalizeBooleanString(
  rawValue: string | undefined,
): string | undefined {
  const value = trimToUndefined(rawValue);
  if (!value) {
    return undefined;
  }

  const normalized = value.toLowerCase();
  if (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  ) {
    return "true";
  }

  if (
    normalized === "0" ||
    normalized === "false" ||
    normalized === "no" ||
    normalized === "off"
  ) {
    return "false";
  }

  return value;
}

function parseInteger(
  rawValue: string | undefined,
  name: string,
  fail: (message: string) => never,
): number | undefined {
  const parsed = parseNumber(rawValue, name, fail);
  if (parsed === undefined) {
    return undefined;
  }

  if (!Number.isInteger(parsed)) {
    fail(`Invalid ${name} value: ${parsed}. Must be an integer`);
  }

  return parsed;
}

function parseBoundedNumber(
  rawValue: string | undefined,
  name: string,
  min: number,
  max: number,
  fail: (message: string) => never,
): number | undefined {
  const parsed = parseNumber(rawValue, name, fail);
  if (parsed === undefined) {
    return undefined;
  }

  if (parsed < min || parsed > max) {
    fail(`Invalid ${name} value: ${parsed}. Must be between ${min} and ${max}`);
  }

  return parsed;
}

function parseMinInteger(
  rawValue: string | undefined,
  name: string,
  min: number,
  fail: (message: string) => never,
): number | undefined {
  const parsed = parseInteger(rawValue, name, fail);
  if (parsed === undefined) {
    return undefined;
  }

  if (parsed < min) {
    fail(`Invalid ${name} value: ${parsed}. Must be >= ${min}`);
  }

  return parsed;
}

function parseReasoningEffort(
  rawValue: string | undefined,
  fail: (message: string) => never,
): ReasoningEffort | undefined {
  const normalized = trimToUndefined(rawValue)?.toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if ((REASONING_EFFORTS as readonly string[]).includes(normalized)) {
    return normalized as ReasoningEffort;
  }

  fail(
    `Invalid OPENAI_REASONING_EFFORT value: ${rawValue}. Use none|minimal|low|medium|high|xhigh`,
  );
}

function parseReasoningSummary(
  rawValue: string | undefined,
  fail: (message: string) => never,
): ReasoningSummaryMode | undefined {
  const normalized = trimToUndefined(rawValue)?.toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if ((REASONING_SUMMARIES as readonly string[]).includes(normalized)) {
    return normalized as ReasoningSummaryMode;
  }

  fail(
    `Invalid OPENAI_REASONING_SUMMARY value: ${rawValue}. Use auto|concise|detailed`,
  );
}

export function loadConfigInputDefaults(): ConfigInputValues {
  const apiKeyEnvName = getEnv("OPENAI_API_KEY_ENV");

  return {
    apiKey:
      getEnv("OPENAI_API_KEY") ||
      (apiKeyEnvName ? getEnv(apiKeyEnvName) : undefined),
    model: getEnv("OPENAI_MODEL"),
    baseUrl: getEnv("OPENAI_BASE_URL") ?? "https://api.openai.com/v1",
    systemPrompt: getRawEnv("OPENAI_SYSTEM_PROMPT") ?? DEFAULT_SYSTEM_PROMPT,
    timeoutMs: process.env.OPENAI_TIMEOUT_MS ?? String(DEFAULT_TIMEOUT_MS),
    debug: normalizeBooleanString(getEnv("OPENAI_DEBUG")) ?? "false",
    useStreaming: normalizeBooleanString(getEnv("OPENAI_STREAM")) ?? "true",
    reasoningEffort: parseReasoningEffort(
      getEnv("OPENAI_REASONING_EFFORT"),
      (message) => {
        throw new Error(message);
      },
    ),
    reasoningSummary: getEnv("OPENAI_REASONING_SUMMARY"),
    temperature: getEnv("OPENAI_TEMPERATURE"),
    topP: getEnv("OPENAI_TOP_P"),
    maxCompletionTokens: getEnv("OPENAI_MAX_COMPLETION_TOKENS"),
  };
}

export function resolveConfig(
  input: ConfigInputValues,
  fail: (message: string) => never,
): AppConfig {
  const prompt = input.prompt?.trim() ?? "";
  if (!prompt) {
    fail("Prompt is required");
  }

  const apiKey = trimToUndefined(input.apiKey);
  const model = trimToUndefined(input.model);

  if (!apiKey) {
    fail(
      "Missing API key. Set OPENAI_API_KEY / OPENAI_API_KEY_ENV or fill it in the form",
    );
  }

  if (!model) {
    fail("Missing model. Set OPENAI_MODEL or fill it in the form");
  }

  const timeoutMs = parseNumber(input.timeoutMs, "OPENAI_TIMEOUT_MS", fail);

  return {
    prompt,
    apiKey,
    model,
    baseUrl: (
      trimToUndefined(input.baseUrl) ?? "https://api.openai.com/v1"
    ).replace(/\/$/, ""),
    systemPrompt: input.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    effectiveTimeoutMs:
      timeoutMs !== undefined && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
    debug: parseBoolean(input.debug, "OPENAI_DEBUG", false, fail),
    useStreaming: parseBoolean(input.useStreaming, "OPENAI_STREAM", true, fail),
    reasoningEffort: parseReasoningEffort(input.reasoningEffort, fail),
    reasoningSummary: parseReasoningSummary(input.reasoningSummary, fail),
    temperature: parseBoundedNumber(
      input.temperature,
      "OPENAI_TEMPERATURE",
      0,
      2,
      fail,
    ),
    topP: parseBoundedNumber(input.topP, "OPENAI_TOP_P", 0, 1, fail),
    maxCompletionTokens: parseMinInteger(
      input.maxCompletionTokens,
      "OPENAI_MAX_COMPLETION_TOKENS",
      1,
      fail,
    ),
  };
}

export function loadConfig(
  rawPrompt: string,
  fail: (message: string) => never,
): AppConfig {
  return resolveConfig(
    {
      ...loadConfigInputDefaults(),
      prompt: rawPrompt,
    },
    (message) => {
      if (message === "Prompt is required") {
        fail('Usage: bun run src/cli.ts "Your prompt"');
      }

      fail(message);
    },
  );
}
