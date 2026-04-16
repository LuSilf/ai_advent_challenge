import type OpenAI from "openai";
import type { ResponseCreateParams } from "openai/resources/responses/responses";
import type { Response } from "openai/resources/responses/responses";
import type { LLMRequest, LLMResponse, LLMToolCall } from "../../domain/models";
import type { LLMClient, StreamEvent } from "../../domain/ports/llm-client";

export function buildOpenAIRequest(request: LLMRequest, userPrompt: string): ResponseCreateParams {
  let input: ResponseCreateParams["input"];

  if (request.messages.length > 0) {
    input = [
      ...request.messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      { role: "user" as const, content: userPrompt },
    ];
  } else {
    input = userPrompt;
  }

  const params: ResponseCreateParams = {
    model: request.model,
    instructions: request.instructions,
    input,
    stream: request.params.stream ?? false,
  };

  if (request.params.reasoningEffort) {
    params.reasoning = {
      effort: request.params.reasoningEffort as "low" | "medium" | "high",
      summary: (request.params.reasoningSummary as "auto" | "concise" | "detailed") ?? "auto",
    };
  } else if (request.params.reasoningSummary) {
    params.reasoning = {
      summary: request.params.reasoningSummary as "auto" | "concise" | "detailed",
    };
  }

  if (request.params.temperature !== undefined) {
    params.temperature = request.params.temperature;
  }

  if (request.params.topP !== undefined) {
    params.top_p = request.params.topP;
  }

  if (request.params.maxCompletionTokens !== undefined) {
    params.max_output_tokens = request.params.maxCompletionTokens;
  }

  // Добавляем tools если есть
  if (request.tools && request.tools.length > 0) {
    params.tools = request.tools.map((t) => ({
      type: "function" as const,
      name: t.name,
      description: t.description,
      parameters: t.parameters as Record<string, unknown>,
    }));
  }

  // Structured output через JSON schema
  if (request.responseFormat) {
    params.text = {
      format: {
        type: "json_schema",
        name: request.responseFormat.name,
        strict: request.responseFormat.strict,
        schema: request.responseFormat.schema,
      },
    };
  }

  return params;
}

function parseToolCalls(response: Response): LLMToolCall[] {
  const calls: LLMToolCall[] = [];

  for (const item of response.output) {
    if (item.type === "function_call") {
      calls.push({
        id: item.call_id,
        name: item.name,
        arguments: item.arguments,
      });
    }
  }

  return calls;
}

export class OpenAILLMClient implements LLMClient {
  constructor(private readonly client: OpenAI) {}

  async send(request: LLMRequest): Promise<LLMResponse & { rawResponse?: unknown }> {
    const params = buildOpenAIRequest(request, request.messages.length > 0
      ? request.messages[request.messages.length - 1].content
      : "");

    const response = await this.client.responses.create({ ...params, stream: false });

    const toolCalls = parseToolCalls(response);

    return {
      content: response.output_text ?? "",
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      rawResponse: response,
    };
  }

  async *stream(request: LLMRequest): AsyncIterable<StreamEvent> {
    const params = buildOpenAIRequest(request, request.messages.length > 0
      ? request.messages[request.messages.length - 1].content
      : "");

    const stream = await this.client.responses.create({ ...params, stream: true });

    let responseText = "";
    let completedResponse: Response | undefined;
    const reasoningSummaryParts: string[] = [];

    for await (const event of stream) {
      if (event.type === "response.output_text.delta" && event.delta.length > 0) {
        responseText += event.delta;
        yield { type: "delta", text: event.delta };
      }

      if (event.type === "response.reasoning_summary_text.done") {
        const text = event.text.trim();
        if (text) {
          reasoningSummaryParts.push(text);
          yield { type: "reasoning_summary", text };
        }
      }

      if (event.type === "response.completed") {
        completedResponse = event.response;
      }
    }

    if (!responseText && completedResponse?.output_text) {
      responseText = completedResponse.output_text;
      yield { type: "delta", text: responseText };
    }

    const toolCalls = completedResponse ? parseToolCalls(completedResponse) : [];

    yield {
      type: "done",
      response: {
        content: responseText,
        inputTokens: completedResponse?.usage?.input_tokens ?? 0,
        outputTokens: completedResponse?.usage?.output_tokens ?? 0,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      },
      rawResponse: completedResponse,
    };
  }
}
