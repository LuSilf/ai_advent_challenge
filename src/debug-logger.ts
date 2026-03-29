import type { Response } from "openai/resources/responses/responses";
import pc from "picocolors";

import type { AppConfig } from "./config";

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

export function printOutputMarker(): void {
  console.error(pc.bold(pc.green("[Model output]")));
}

export function printRequestDebug(config: AppConfig, messageCount?: number, factsCount?: number): void {
  debugPrintHeader("Request Debug");
  debugPrintField("Requesting", `${config.baseUrl}/responses`);
  debugPrintField("Model", config.model);
  debugPrintField("Context strategy", config.contextStrategy);
  if (messageCount !== undefined) {
    debugPrintField("Messages in context", messageCount);
  }
  if (factsCount !== undefined && factsCount > 0) {
    debugPrintField("Facts in context", factsCount);
  }
  debugPrintField("Timeout", `${config.effectiveTimeoutMs}ms`);
  debugPrintField("Stream", config.useStreaming ? "enabled" : "disabled");
  debugPrintField("Reasoning effort", formatOptional(config.reasoningEffort));
  debugPrintField("Reasoning summary mode", formatOptional(config.reasoningSummary));
  debugPrintField("Temperature", formatOptional(config.temperature));
  debugPrintField("Top-p", formatOptional(config.topP));
  debugPrintField("N", formatOptional(config.n));
  debugPrintField("Max completion tokens", formatOptional(config.maxCompletionTokens));
  debugPrintField("Presence penalty", formatOptional(config.presencePenalty));
  debugPrintField("Frequency penalty", formatOptional(config.frequencyPenalty));

  if (config.n !== undefined) {
    debugPrintNote("OPENAI_N is not supported by Responses API and will be ignored");
  }

  if (config.presencePenalty !== undefined) {
    debugPrintNote("OPENAI_PRESENCE_PENALTY is not supported by Responses API and will be ignored");
  }

  if (config.frequencyPenalty !== undefined) {
    debugPrintNote("OPENAI_FREQUENCY_PENALTY is not supported by Responses API and will be ignored");
  }

  debugPrintSection("Prompts");
  debugPrintPromptBlock("System prompt", config.systemPrompt);
  console.error("");
  debugPrintPromptBlock("User prompt", config.prompt);
  debugPrintFooter();
}

export function printResponseDebug(response: Response, startedAtMs: number, fallbackSummaries?: string[]): void {
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
