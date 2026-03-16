import type { ResponseCreateParams } from "openai/resources/responses/responses";

import type { AppConfig } from "./config";

export function buildResponseRequest(config: AppConfig): ResponseCreateParams {
  const request: ResponseCreateParams = {
    model: config.model,
    instructions: config.systemPrompt,
    input: config.prompt,
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
