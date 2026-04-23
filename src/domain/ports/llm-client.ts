import type { LLMRequest, LLMResponse } from "../models";

export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; response: LLMResponse; rawResponse?: unknown };

export interface LLMClient {
  send(request: LLMRequest): Promise<LLMResponse & { rawResponse?: unknown }>;
  stream(request: LLMRequest): AsyncIterable<StreamEvent>;
}
