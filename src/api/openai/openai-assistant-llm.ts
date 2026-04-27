import type OpenAI from "openai";
import type {
  ChatCompletionChunk,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
} from "openai/resources/chat/completions";

import type {
  AssistantChatMessage,
  AssistantLLMClient,
  AssistantStreamEvent,
  AssistantStreamRequest,
  AssistantToolCall,
} from "../../domain/ports/assistant-llm";

export class OpenAIAssistantLLMClient implements AssistantLLMClient {
  constructor(private readonly client: OpenAI) {}

  async *stream(request: AssistantStreamRequest): AsyncIterable<AssistantStreamEvent> {
    const messages = request.messages.map(toOpenAIMessage);
    const tools = request.tools?.map(
      (t): ChatCompletionTool => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }),
    );

    const stream = await this.client.chat.completions.create({
      model: request.model,
      messages,
      stream: true,
      stream_options: { include_usage: false },
      tools,
      temperature: request.temperature,
    });

    const toolAccs = new Map<number, { id?: string; name?: string; arguments: string }>();
    let finishReason: AssistantStreamEvent["kind"] extends "done" ? never : never;
    let lastFinish: "stop" | "tool_calls" | "length" | "other" = "other";

    for await (const chunk of stream as AsyncIterable<ChatCompletionChunk>) {
      const choice = chunk.choices[0];
      if (!choice) continue;

      if (choice.delta?.content) {
        yield { kind: "delta", text: choice.delta.content };
      }

      if (choice.delta?.tool_calls) {
        for (const td of choice.delta.tool_calls) {
          const slot = toolAccs.get(td.index) ?? { arguments: "" };
          if (td.id) slot.id = td.id;
          if (td.function?.name) slot.name = td.function.name;
          if (td.function?.arguments) slot.arguments += td.function.arguments;
          toolAccs.set(td.index, slot);
        }
      }

      if (choice.finish_reason) {
        const reason = choice.finish_reason;
        if (reason === "stop" || reason === "tool_calls" || reason === "length") {
          lastFinish = reason;
        } else {
          lastFinish = "other";
        }
      }
    }

    if (toolAccs.size > 0) {
      const calls: AssistantToolCall[] = [];
      for (const slot of toolAccs.values()) {
        if (slot.id && slot.name) {
          calls.push({ id: slot.id, name: slot.name, arguments: slot.arguments });
        }
      }
      if (calls.length > 0) yield { kind: "tool_call", calls };
    }

    yield { kind: "done", finishReason: lastFinish };
  }
}

function toOpenAIMessage(m: AssistantChatMessage): ChatCompletionMessageParam {
  switch (m.role) {
    case "system":
      return { role: "system", content: m.content };
    case "user":
      return { role: "user", content: m.content };
    case "assistant": {
      const out: ChatCompletionMessageParam = { role: "assistant", content: m.content };
      if (m.toolCalls && m.toolCalls.length > 0) {
        (out as { tool_calls?: ChatCompletionMessageToolCall[] }).tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        }));
      }
      return out;
    }
    case "tool":
      return { role: "tool", content: m.content, tool_call_id: m.toolCallId };
  }
}
