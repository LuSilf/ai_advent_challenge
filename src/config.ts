const DEFAULT_TIMEOUT_MS = 30_000;

const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;

type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
type ReasoningSummaryMode = "auto" | "concise" | "detailed";

export type AppConfig = {
  prompt: string;
  apiKey: string;
  baseUrl: string;
  systemPrompt: string;
  effectiveTimeoutMs: number;
  debug: boolean;
  useStreaming: boolean;
  historyDb: string;
  historyLimit: number;
  contextStrategy: string;
  sessionId?: number;
  reasoningEffort?: ReasoningEffort;
  reasoningSummary?: ReasoningSummaryMode;
  temperature?: number;
  topP?: number;
  n?: number;
  maxCompletionTokens?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
};

const DEFAULT_SYSTEM_PROMPT = "";

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

export function loadConfig(args: string[], fail: (message: string) => never): AppConfig {
  let sessionId: number | undefined;
  const promptParts: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--session" && i + 1 < args.length) {
      const parsed = Number(args[i + 1]);
      if (!Number.isInteger(parsed) || parsed < 1) {
        fail(`Invalid --session value: ${args[i + 1]}. Must be a positive integer`);
      }
      sessionId = parsed;
      i++;
    } else {
      promptParts.push(args[i]);
    }
  }

  const prompt = promptParts.join(" ").trim();

  const apiKeyEnvName = getEnv("OPENAI_API_KEY_ENV");
  const apiKey = getEnv("OPENAI_API_KEY") || (apiKeyEnvName ? getEnv(apiKeyEnvName) : undefined);

  if (!apiKey) {
    fail("Missing API key. Set OPENAI_API_KEY or OPENAI_API_KEY_ENV");
  }

  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS ?? String(DEFAULT_TIMEOUT_MS));
  const historyLimit = parseMinInteger("HISTORY_LIMIT", 1, fail) ?? 50;

  const contextStrategy = getEnv("CONTEXT_STRATEGY") ?? "full";
  const validStrategies = ["full", "sliding"];
  if (!validStrategies.includes(contextStrategy)) {
    fail(`Invalid CONTEXT_STRATEGY value: ${contextStrategy}. Use ${validStrategies.join("|")}`);
  }

  return {
    prompt,
    apiKey,
    baseUrl: (getEnv("OPENAI_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/$/, ""),
    systemPrompt: process.env.OPENAI_SYSTEM_PROMPT ?? DEFAULT_SYSTEM_PROMPT,
    effectiveTimeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
    debug: parseBooleanEnv("OPENAI_DEBUG", false, fail),
    useStreaming: parseBooleanEnv("OPENAI_STREAM", true, fail),
    historyDb: getEnv("HISTORY_DB") ?? "./data/history.db",
    historyLimit,
    contextStrategy,
    sessionId,
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

export function applyDbOptions(config: AppConfig, getOption: (key: string) => string | null): void {
  const systemPrompt = getOption("system_prompt");
  if (systemPrompt) {
    config.systemPrompt = systemPrompt;
  }

  const temperature = getOption("temperature");
  if (temperature) {
    const parsed = Number(temperature);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 2) {
      config.temperature = parsed;
    }
  }

  const topP = getOption("top_p");
  if (topP) {
    const parsed = Number(topP);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
      config.topP = parsed;
    }
  }

  const debug = getOption("debug");
  if (debug) {
    const normalized = debug.toLowerCase();
    if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
      config.debug = true;
    } else if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
      config.debug = false;
    }
  }

  const contextStrategy = getOption("context_strategy");
  if (contextStrategy && (contextStrategy === "full" || contextStrategy === "sliding")) {
    config.contextStrategy = contextStrategy;
  }
}
