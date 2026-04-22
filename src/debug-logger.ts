import type { ChatCompletion } from "openai/resources/chat/completions";
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

export function printOutputMarker(): void {
  console.error(pc.bold(pc.green("[Model output]")));
}

export type DebugContext = {
  messageCount?: number;
  longTermMemory?: string;
  workingMemory?: string;
  factsBlock?: string;
};

export function printRequestDebug(config: AppConfig, model?: string, ctx?: DebugContext): void {
  const messageCount = ctx?.messageCount;
  const factsCount = ctx?.factsBlock ? 1 : 0;
  debugPrintHeader("Request Debug");
  debugPrintField("Requesting", `${config.baseUrl}/chat/completions`);
  debugPrintField("Model", model ?? "(unknown)");
  debugPrintField("Context strategy", config.contextStrategy);
  if (messageCount !== undefined) {
    debugPrintField("Messages in context", messageCount);
  }
  if (factsCount !== undefined && factsCount > 0) {
    debugPrintField("Facts in context", factsCount);
  }
  debugPrintField("Timeout", `${config.effectiveTimeoutMs}ms`);
  debugPrintField("Stream", config.useStreaming ? "enabled" : "disabled");
  debugPrintField("Temperature", formatOptional(config.temperature));
  debugPrintField("Top-p", formatOptional(config.topP));
  debugPrintField("N", formatOptional(config.n));
  debugPrintField("Max completion tokens", formatOptional(config.maxCompletionTokens));
  debugPrintField("Presence penalty", formatOptional(config.presencePenalty));
  debugPrintField("Frequency penalty", formatOptional(config.frequencyPenalty));

  if (config.n !== undefined && config.n !== 1) {
    debugPrintNote("OPENAI_N > 1 is not wired through the current request builder");
  }

  debugPrintSection("Prompts");

  if (ctx?.longTermMemory) {
    debugPrintPromptBlock("Долговременная память", ctx.longTermMemory);
    console.error("");
  }

  if (ctx?.workingMemory) {
    debugPrintPromptBlock("Рабочая память проекта", ctx.workingMemory);
    console.error("");
  }

  if (ctx?.factsBlock) {
    debugPrintPromptBlock("Facts block", ctx.factsBlock);
    console.error("");
  }

  debugPrintPromptBlock("System prompt", config.systemPrompt || "(пусто)");
  console.error("");
  debugPrintPromptBlock("User prompt", config.prompt);
  debugPrintFooter();
}

export function printResponseDebug(response: ChatCompletion, startedAtMs: number): void {
  const wallTimeMs = Date.now() - startedAtMs;

  debugPrintHeader("Response Debug");
  debugPrintField("Response ID", response.id ?? "(not set)");
  debugPrintField("Model", response.model ?? "(not set)");
  debugPrintField("Created at", formatUnixSeconds(response.created));
  debugPrintField("Client wall time", formatMs(wallTimeMs));

  const finishReason = response.choices?.[0]?.finish_reason;
  debugPrintField("Finish reason", formatOptional(finishReason ?? null));

  const usage = response.usage;
  if (usage) {
    const inputTokens = usage.prompt_tokens ?? 0;
    const outputTokens = usage.completion_tokens ?? 0;
    const totalTokens = usage.total_tokens ?? inputTokens + outputTokens;

    debugPrintSection("Token usage");
    debugPrintField("Prompt tokens", inputTokens);
    debugPrintField("Completion tokens", outputTokens);
    debugPrintField("Total tokens", totalTokens);

    if (wallTimeMs > 0) {
      const outputTps = outputTokens / (wallTimeMs / 1000);
      debugPrintField("Output throughput", `${outputTps.toFixed(2)} tok/s`);
    }
  } else {
    debugPrintSection("Token usage");
    debugPrintField("Availability", "(not returned by provider)");
  }

  debugPrintFooter();
}
