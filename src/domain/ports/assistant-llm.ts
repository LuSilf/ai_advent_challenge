export type AssistantToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type AssistantToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type AssistantChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: AssistantToolCall[] }
  | { role: "tool"; content: string; toolCallId: string };

export type AssistantStreamEvent =
  | { kind: "delta"; text: string }
  | { kind: "tool_call"; calls: AssistantToolCall[] }
  | { kind: "done"; finishReason: "stop" | "tool_calls" | "length" | "other" };

export type AssistantStreamRequest = {
  model: string;
  messages: AssistantChatMessage[];
  tools?: AssistantToolDefinition[];
  temperature?: number;
};

export interface AssistantLLMClient {
  stream(request: AssistantStreamRequest): AsyncIterable<AssistantStreamEvent>;
}
