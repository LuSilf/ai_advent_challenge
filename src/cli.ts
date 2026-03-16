import OpenAI from "openai";
import type { Response, ResponseCreateParams } from "openai/resources/responses/responses";
import pc from "picocolors";

const prompt = Bun.argv.slice(2).join(" ").trim();

const DEFAULT_TIMEOUT_MS = 30_000;
const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;

type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
type ReasoningSummaryMode = "auto" | "concise" | "detailed";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function getEnv(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function getHttpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return undefined;
  }

  const status = Number((error as { status?: number }).status);
  return Number.isFinite(status) ? status : undefined;
}

function parseNumberEnv(name: string): number | undefined {
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

function parseBooleanEnv(name: string, defaultValue: boolean): boolean {
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

function parseIntegerEnv(name: string): number | undefined {
  const parsed = parseNumberEnv(name);
  if (parsed === undefined) {
    return undefined;
  }

  if (!Number.isInteger(parsed)) {
    fail(`Invalid ${name} value: ${parsed}. Must be an integer`);
  }

  return parsed;
}

function parseBoundedNumber(name: string, min: number, max: number): number | undefined {
  const parsed = parseNumberEnv(name);
  if (parsed === undefined) {
    return undefined;
  }

  if (parsed < min || parsed > max) {
    fail(`Invalid ${name} value: ${parsed}. Must be between ${min} and ${max}`);
  }

  return parsed;
}

function parseMinInteger(name: string, min: number): number | undefined {
  const parsed = parseIntegerEnv(name);
  if (parsed === undefined) {
    return undefined;
  }

  if (parsed < min) {
    fail(`Invalid ${name} value: ${parsed}. Must be >= ${min}`);
  }

  return parsed;
}

function parseReasoningEffort(rawValue: string | undefined): ReasoningEffort | undefined {
  if (!rawValue) {
    return undefined;
  }

  const normalized = rawValue.toLowerCase();
  if ((REASONING_EFFORTS as readonly string[]).includes(normalized)) {
    return normalized as ReasoningEffort;
  }

  fail(`Invalid OPENAI_REASONING_EFFORT value: ${rawValue}. Use none|minimal|low|medium|high|xhigh`);
}

function parseReasoningSummary(rawValue: string | undefined): ReasoningSummaryMode | undefined {
  if (!rawValue) {
    return undefined;
  }

  const normalized = rawValue.toLowerCase();
  if (normalized === "auto" || normalized === "concise" || normalized === "detailed") {
    return normalized;
  }

  fail(`Invalid OPENAI_REASONING_SUMMARY value: ${rawValue}. Use auto|concise|detailed`);
}

function formatOptional(value: string | number | boolean | undefined | null): string {
  return value === undefined || value === null ? "(not set)" : String(value);
}

function formatUnixSeconds(timestamp: number | undefined | null): string {
  if (timestamp === undefined || timestamp === null) {
    return "(not set)";
  }

  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) {
    return `${timestamp} (invalid)`;
  }

  return `${timestamp} (${date.toISOString()})`;
}

function formatMs(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "(not set)";
  }

  return `${value}ms`;
}

function debugPrintHeader(title: string): void {
  const line = "=".repeat(62);
  console.error(pc.dim(line));
  console.error(pc.bold(pc.cyan(`  ${title}`)));
  console.error(pc.dim(line));
}

function debugPrintFooter(): void {
  console.error(pc.dim("=".repeat(62)));
}

function debugPrintField(label: string, value: string | number): void {
  console.error(`${pc.bold(pc.blue(label.padEnd(24)))} ${pc.dim(":")} ${value}`);
}

function debugPrintSection(title: string): void {
  console.error(pc.bold(pc.magenta(`[${title}]`)));
}

function debugPrintPromptBlock(title: string, content: string): void {
  const rule = pc.dim("-".repeat(62));
  console.error(rule);
  console.error(pc.bold(pc.green(`  ${title}`)));
  console.error(rule);
  console.error(content);
}

function debugPrintNote(message: string): void {
  console.error(pc.yellow(`Note: ${message}`));
}

function debugPrintOutputMarker(): void {
  console.error(pc.bold(pc.green("[Model output]")));
}

function extractReasoningSummaries(response: Response): string[] {
  const summaries: string[] = [];

  for (const item of response.output) {
    if (item.type !== "reasoning") {
      continue;
    }

    for (const part of item.summary) {
      const text = part.text?.trim();
      if (text) {
        summaries.push(text);
      }
    }
  }

  return summaries;
}

function printDebugResponseStats(response: Response, startedAtMs: number, fallbackSummaries?: string[]): void {
  const completedAtMsFromApi = response.completed_at ? response.completed_at * 1000 : undefined;
  const createdAtMsFromApi = response.created_at ? response.created_at * 1000 : undefined;

  const wallTimeMs = Date.now() - startedAtMs;
  const queueToCompletionMs =
    createdAtMsFromApi !== undefined && completedAtMsFromApi !== undefined
      ? Math.max(0, completedAtMsFromApi - createdAtMsFromApi)
      : undefined;

  debugPrintHeader("Response Debug");
  debugPrintField("Response ID", response.id);
  debugPrintField("Response status", formatOptional(response.status));
  debugPrintField("Service tier", formatOptional(response.service_tier));
  debugPrintField("Created at", formatUnixSeconds(response.created_at));
  debugPrintField("Completed at", formatUnixSeconds(response.completed_at));
  debugPrintField("Model queue->complete", formatMs(queueToCompletionMs));
  debugPrintField("Client wall time", formatMs(wallTimeMs));

  const usage = response.usage;
  if (usage) {
    const inputTokens = usage.input_tokens;
    const outputTokens = usage.output_tokens;
    const totalTokens = usage.total_tokens;
    const cachedInputTokens = usage.input_tokens_details.cached_tokens;
    const reasoningTokens = usage.output_tokens_details.reasoning_tokens;

    debugPrintSection("Token usage");
    debugPrintField("Input tokens", inputTokens);
    debugPrintField("Output tokens", outputTokens);
    debugPrintField("Total tokens", totalTokens);
    debugPrintField("Cached input tokens", cachedInputTokens);
    debugPrintField("Reasoning tokens", reasoningTokens);

    if (wallTimeMs > 0) {
      const outputTps = outputTokens / (wallTimeMs / 1000);
      debugPrintField("Output throughput", `${outputTps.toFixed(2)} tok/s`);
    }
  } else {
    debugPrintSection("Token usage");
    debugPrintField("Availability", "(not returned by provider)");
  }

  const summaries = extractReasoningSummaries(response);
  const effectiveSummaries = summaries.length > 0 ? summaries : fallbackSummaries ?? [];
  if (effectiveSummaries.length > 0) {
    debugPrintSection("Reasoning summary");
    for (const summary of effectiveSummaries) {
      console.error(`- ${summary}`);
    }
  } else {
    debugPrintSection("Reasoning summary");
    debugPrintField("Availability", "(not returned)");
  }

  if (response.incomplete_details?.reason) {
    debugPrintField("Incomplete reason", response.incomplete_details.reason);
  }

  if (response.error) {
    debugPrintField("Response error", response.error.message);
  }

  debugPrintFooter();
}

function isTimeoutError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  if ("name" in error && error.name === "AbortError") {
    return true;
  }

  if (!("message" in error) || typeof error.message !== "string") {
    return false;
  }

  return error.message.toLowerCase().includes("timed out");
}

const DEFAULT_SYSTEM_PROMPT = `You are a poetic assistant.
All responses must be written as poetry in Russian.

Poetry specification:

Language: Russian
Poetic form: two quatrains (2 stanzas, 4 lines each)
Meter: iambic tetrameter
Rhyme scheme: ABAB
Line length: approximately 8–9 syllables
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

if (!prompt) {
  fail('Usage: bun run src/cli.ts "Your prompt"');
}

const apiKeyEnvName = getEnv("OPENAI_API_KEY_ENV");
const apiKey = getEnv("OPENAI_API_KEY") || (apiKeyEnvName ? getEnv(apiKeyEnvName) : undefined);
const model = getEnv("OPENAI_MODEL");
const baseUrl = (getEnv("OPENAI_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/$/, "");
const systemPrompt = process.env.OPENAI_SYSTEM_PROMPT ?? DEFAULT_SYSTEM_PROMPT;
const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS ?? String(DEFAULT_TIMEOUT_MS));
const debug = parseBooleanEnv("OPENAI_DEBUG", false);
const useStreaming = parseBooleanEnv("OPENAI_STREAM", true);
const effectiveTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
const reasoningEffort = parseReasoningEffort(getEnv("OPENAI_REASONING_EFFORT"));
const reasoningSummary = parseReasoningSummary(getEnv("OPENAI_REASONING_SUMMARY"));
const temperature = parseBoundedNumber("OPENAI_TEMPERATURE", 0, 2);
const topP = parseBoundedNumber("OPENAI_TOP_P", 0, 1);
const n = parseMinInteger("OPENAI_N", 1);
const maxCompletionTokens = parseMinInteger("OPENAI_MAX_COMPLETION_TOKENS", 1);
const presencePenalty = parseBoundedNumber("OPENAI_PRESENCE_PENALTY", -2, 2);
const frequencyPenalty = parseBoundedNumber("OPENAI_FREQUENCY_PENALTY", -2, 2);

if (!apiKey) {
  fail("Missing API key. Set OPENAI_API_KEY or OPENAI_API_KEY_ENV");
}

if (!model) {
  fail("Missing OPENAI_MODEL environment variable");
}

const client = new OpenAI({
  apiKey,
  baseURL: baseUrl,
  timeout: effectiveTimeoutMs,
  maxRetries: 0
});

if (debug) {
  debugPrintHeader("Request Debug");
  debugPrintField("Requesting", `${baseUrl}/responses`);
  debugPrintField("Model", model);
  debugPrintField("Timeout", `${effectiveTimeoutMs}ms`);
  debugPrintField("Stream", useStreaming ? "enabled" : "disabled");
  debugPrintField("Reasoning effort", formatOptional(reasoningEffort));
  debugPrintField("Reasoning summary mode", formatOptional(reasoningSummary));
  debugPrintField("Temperature", formatOptional(temperature));
  debugPrintField("Top-p", formatOptional(topP));
  debugPrintField("N", formatOptional(n));
  debugPrintField("Max completion tokens", formatOptional(maxCompletionTokens));
  debugPrintField("Presence penalty", formatOptional(presencePenalty));
  debugPrintField("Frequency penalty", formatOptional(frequencyPenalty));
  if (n !== undefined) {
    debugPrintNote("OPENAI_N is not supported by Responses API and will be ignored");
  }
  if (presencePenalty !== undefined) {
    debugPrintNote("OPENAI_PRESENCE_PENALTY is not supported by Responses API and will be ignored");
  }
  if (frequencyPenalty !== undefined) {
    debugPrintNote("OPENAI_FREQUENCY_PENALTY is not supported by Responses API and will be ignored");
  }
  debugPrintSection("Prompts");
  debugPrintPromptBlock("System prompt", systemPrompt);
  console.error("");
  debugPrintPromptBlock("User prompt", prompt);
  debugPrintFooter();
}

try {
  const request: ResponseCreateParams = {
    model,
    instructions: systemPrompt,
    input: prompt,
    stream: useStreaming
  };

  if (reasoningEffort) {
    request.reasoning = {
      effort: reasoningEffort,
      summary: reasoningSummary ?? "auto"
    };
  } else if (reasoningSummary) {
    request.reasoning = {
      summary: reasoningSummary
    };
  }

  if (temperature !== undefined) {
    request.temperature = temperature;
  }

  if (topP !== undefined) {
    request.top_p = topP;
  }

  if (maxCompletionTokens !== undefined) {
    request.max_output_tokens = maxCompletionTokens;
  }

  const startedAtMs = Date.now();

  let wroteOutputNewline = false;

  if (useStreaming) {
    const stream = await client.responses.create({ ...request, stream: true });

    let hasOutput = false;
    let completedResponse: Response | undefined;
    const reasoningSummaryParts: string[] = [];

    if (debug) {
      debugPrintOutputMarker();
    }

    for await (const event of stream) {
      if (event.type === "response.output_text.delta" && event.delta.length > 0) {
        process.stdout.write(event.delta);
        hasOutput = true;
      }

      if (event.type === "response.reasoning_summary_text.done") {
        const text = event.text.trim();
        if (text) {
          reasoningSummaryParts.push(text);
        }
      }

      if (event.type === "response.completed") {
        completedResponse = event.response;
      }
    }

    if (!hasOutput && completedResponse?.output_text) {
      process.stdout.write(completedResponse.output_text);
      hasOutput = true;
    }

    if (!hasOutput) {
      fail("No text content found in model response");
    }

    if (debug && completedResponse) {
      process.stdout.write("\n");
      wroteOutputNewline = true;
      printDebugResponseStats(completedResponse, startedAtMs, reasoningSummaryParts);
    }
  } else {
    const response = await client.responses.create({ ...request, stream: false });

    const content = response.output_text;

    if (typeof content !== "string" || content.length === 0) {
      fail("No text content found in model response");
    }

    if (debug) {
      debugPrintOutputMarker();
    }

    process.stdout.write(content);

    if (debug) {
      process.stdout.write("\n");
      wroteOutputNewline = true;
      printDebugResponseStats(response, startedAtMs);
    }
  }

  if (!wroteOutputNewline) {
    process.stdout.write("\n");
  }
  process.exit(0);
} catch (error) {
  const status = getHttpStatus(error);

  if (isTimeoutError(error)) {
    console.error(`Request timed out after ${effectiveTimeoutMs}ms`);
    console.error("Check OPENAI_BASE_URL and network connectivity");
    process.exit(1);
  }

  if (status === 429) {
    console.error("Rate limit reached (HTTP 429)");
    console.error("Switch model/provider or wait before the next request");
    console.error("Also check account quota/credits on the provider side");
    process.exit(1);
  }

  console.error("LLM request failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
