import type OpenAI from "openai";
import type { ChatCompletion, ChatCompletionCreateParams, ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { LLMRequest, LLMResponse, LLMToolCall } from "../../domain/models";
import type { LLMClient, StreamEvent } from "../../domain/ports/llm-client";

export function buildOpenAIRequest(request: LLMRequest, userPrompt: string): ChatCompletionCreateParams {
  const messages: ChatCompletionMessageParam[] = [];

  if (request.instructions) {
    messages.push({ role: "system", content: request.instructions });
  }

  for (const m of request.messages) {
    messages.push({ role: m.role, content: m.content });
  }

  if (request.messages.length === 0 || request.messages[request.messages.length - 1]?.content !== userPrompt) {
    messages.push({ role: "user", content: userPrompt });
  }

  const params: ChatCompletionCreateParams = {
    model: request.model,
    messages,
    stream: request.params.stream ?? false,
  };

  if (request.params.temperature !== undefined) {
    params.temperature = request.params.temperature;
  }

  if (request.params.topP !== undefined) {
    params.top_p = request.params.topP;
  }

  if (request.params.maxCompletionTokens !== undefined) {
    params.max_completion_tokens = request.params.maxCompletionTokens;
  }

  if (request.tools && request.tools.length > 0) {
    params.tools = request.tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters as Record<string, unknown>,
      },
    }));
  }

  if (request.responseFormat) {
    params.response_format = {
      type: "json_schema",
      json_schema: {
        name: request.responseFormat.name,
        strict: request.responseFormat.strict,
        schema: request.responseFormat.schema,
      },
    };
  }

  return params;
}

function parseToolCalls(completion: ChatCompletion): LLMToolCall[] {
  const message = completion.choices[0]?.message;
  if (!message?.tool_calls || message.tool_calls.length === 0) {
    return [];
  }

  const calls: LLMToolCall[] = [];
  for (const call of message.tool_calls) {
    if (call.type !== "function") {
      continue;
    }
    calls.push({
      id: call.id,
      name: call.function.name,
      arguments: call.function.arguments,
    });
  }

  return calls;
}

export class OpenAILLMClient implements LLMClient {
  constructor(private readonly client: OpenAI) {}

  async send(request: LLMRequest): Promise<LLMResponse & { rawResponse?: unknown }> {
    const userPrompt = request.messages.length > 0
      ? request.messages[request.messages.length - 1].content
      : "";
    const params = buildOpenAIRequest(request, userPrompt);

    const completion = await this.client.chat.completions.create({ ...params, stream: false }) as ChatCompletion;
    const message = completion.choices[0]?.message;
    const toolCalls = parseToolCalls(completion);

    return {
      content: message?.content ?? "",
      inputTokens: completion.usage?.prompt_tokens ?? 0,
      outputTokens: completion.usage?.completion_tokens ?? 0,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      rawResponse: completion,
    };
  }

  async *stream(request: LLMRequest): AsyncIterable<StreamEvent> {
    const userPrompt = request.messages.length > 0
      ? request.messages[request.messages.length - 1].content
      : "";
    const params = buildOpenAIRequest(request, userPrompt);

    const stream = await this.client.chat.completions.create({
      ...params,
      stream: true,
      stream_options: { include_usage: true },
    });

    let responseText = "";
    let promptTokens = 0;
    let completionTokens = 0;
    const toolCallAccumulators: Map<number, { id?: string; name?: string; arguments: string }> = new Map();
    let lastRawChunk: unknown;

    for await (const chunk of stream) {
      lastRawChunk = chunk;
      const choice = chunk.choices[0];
      if (choice?.delta?.content) {
        responseText += choice.delta.content;
        yield { type: "delta", text: choice.delta.content };
      }

      if (choice?.delta?.tool_calls) {
        for (const toolDelta of choice.delta.tool_calls) {
          const slot = toolCallAccumulators.get(toolDelta.index) ?? { arguments: "" };
          if (toolDelta.id) slot.id = toolDelta.id;
          if (toolDelta.function?.name) slot.name = toolDelta.function.name;
          if (toolDelta.function?.arguments) slot.arguments += toolDelta.function.arguments;
          toolCallAccumulators.set(toolDelta.index, slot);
        }
      }

      if (chunk.usage) {
        promptTokens = chunk.usage.prompt_tokens ?? promptTokens;
        completionTokens = chunk.usage.completion_tokens ?? completionTokens;
      }
    }

    const toolCalls: LLMToolCall[] = [];
    for (const slot of toolCallAccumulators.values()) {
      if (slot.id && slot.name) {
        toolCalls.push({ id: slot.id, name: slot.name, arguments: slot.arguments });
      }
    }

    yield {
      type: "done",
      response: {
        content: responseText,
        inputTokens: promptTokens,
        outputTokens: completionTokens,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      },
      rawResponse: lastRawChunk,
    };
  }
}
