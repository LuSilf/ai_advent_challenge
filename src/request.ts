import type { ResponseCreateParams } from "openai/resources/responses/responses";

import type { AppConfig } from "./config";
import { buildMemoryBlocks } from "./memory";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export function buildResponseRequest(
  config: AppConfig,
  model: string,
  history?: ChatMessage[],
  factsBlock?: string
): ResponseCreateParams {
  let input: ResponseCreateParams["input"];
  if (history && history.length > 0) {
    input = [
      ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      { role: "user" as const, content: config.prompt }
    ];
  } else {
    input = config.prompt;
  }

  const memoryBlocks = buildMemoryBlocks();
  let instructions = config.systemPrompt;
  if (memoryBlocks) {
    instructions = `${memoryBlocks}\n\n${instructions}`;
  }
  if (factsBlock) {
    instructions = `${factsBlock}\n\n${instructions}`;
  }

  const request: ResponseCreateParams = {
    model,
    instructions,
    input,
    stream: config.useStreaming
  };

  if (config.reasoningEffort) {
    request.reasoning = {
      effort: config.reasoningEffort,
      summary: config.reasoningSummary ?? "auto"
    };
  } else if (config.reasoningSummary) {
    request.reasoning = {
      summary: config.reasoningSummary
    };
  }

  if (config.temperature !== undefined) {
    request.temperature = config.temperature;
  }

  if (config.topP !== undefined) {
    request.top_p = config.topP;
  }

  if (config.maxCompletionTokens !== undefined) {
    request.max_output_tokens = config.maxCompletionTokens;
  }

  return request;
}
