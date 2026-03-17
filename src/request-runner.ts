import OpenAI from "openai";
import type { Response } from "openai/resources/responses/responses";

import type { AppConfig } from "./config";
import { buildResponseRequest } from "./request";

export type RequestRunResult = {
  outputText: string;
  response?: Response;
  reasoningSummaryParts: string[];
  startedAtMs: number;
};

type RequestRunHooks = {
  onOutputTextDelta?: (delta: string) => void;
};

export function getHttpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return undefined;
  }

  const status = Number((error as { status?: number }).status);
  return Number.isFinite(status) ? status : undefined;
}

export function isTimeoutError(error: unknown): boolean {
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

export async function runResponseRequest(config: AppConfig, hooks: RequestRunHooks = {}): Promise<RequestRunResult> {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    timeout: config.effectiveTimeoutMs,
    maxRetries: 0
  });

  const request = buildResponseRequest(config);
  const startedAtMs = Date.now();

  if (config.useStreaming) {
    const stream = await client.responses.create({ ...request, stream: true });
    const chunks: string[] = [];
    const reasoningSummaryParts: string[] = [];
    let completedResponse: Response | undefined;

    for await (const event of stream) {
      if (event.type === "response.output_text.delta" && event.delta.length > 0) {
        chunks.push(event.delta);
        hooks.onOutputTextDelta?.(event.delta);
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

    let outputText = chunks.join("");
    if (!outputText && completedResponse?.output_text) {
      outputText = completedResponse.output_text;
      hooks.onOutputTextDelta?.(outputText);
    }

    if (!outputText) {
      throw new Error("No text content found in model response");
    }

    return {
      outputText,
      response: completedResponse,
      reasoningSummaryParts,
      startedAtMs
    };
  }

  const response = await client.responses.create({ ...request, stream: false });
  const outputText = response.output_text;

  if (typeof outputText !== "string" || outputText.length === 0) {
    throw new Error("No text content found in model response");
  }

  hooks.onOutputTextDelta?.(outputText);

  return {
    outputText,
    response,
    reasoningSummaryParts: [],
    startedAtMs
  };
}
