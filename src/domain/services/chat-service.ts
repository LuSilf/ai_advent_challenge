import type { CostInfo, LLMRequest, LLMResponse, Model, Message } from "../models";
import type { LLMClient, StreamEvent } from "../ports/llm-client";
import type { MessageRepository } from "../ports/message-repository";
import type { FactRepository } from "../ports/fact-repository";
import type { ModelRepository } from "../ports/model-repository";
import type { SessionService } from "./session-service";
import type { ContextService, ContextResult } from "./context-service";
import type { CostService } from "./cost-service";

export type SendMessageOptions = {
  historyLimit: number;
  systemPrompt: string;
  useStreaming: boolean;
  memoryBlocks?: string;
  temperature?: number;
  topP?: number;
  maxCompletionTokens?: number;
  reasoningEffort?: string;
  reasoningSummary?: string;
  onDelta?: (text: string) => void;
  onReasoningSummary?: (text: string) => void;
};

export type SendMessageResult = {
  response: LLMResponse;
  costInfo: CostInfo | null;
  model: Model;
  rawResponse?: unknown;
};

export class ChatService {
  constructor(
    private readonly llmClient: LLMClient,
    private readonly sessionService: SessionService,
    private readonly contextService: ContextService,
    private readonly costService: CostService,
    private readonly messageRepo: MessageRepository,
    private readonly factRepo: FactRepository,
    private readonly modelRepo: ModelRepository,
  ) {}

  async sendMessage(
    sessionId: number,
    userPrompt: string,
    options: SendMessageOptions,
  ): Promise<SendMessageResult> {
    const chatModel = this.modelRepo.getRole("chat");
    const model = chatModel ?? { id: "openai/gpt-5-nano", name: "GPT-5 Nano", inputPrice: 0.05, outputPrice: 0.40, contextSize: 400_000 };

    // Build context from history
    const strategy = this.sessionService.getStrategy(sessionId);
    const messages = this.messageRepo.getBySession(sessionId);
    const facts = this.factRepo.getBySession(sessionId);
    const context = this.contextService.buildContext(messages, facts, strategy, options.historyLimit);

    // Save user message
    this.messageRepo.add(sessionId, "user", userPrompt);

    // Build instructions
    let instructions = options.systemPrompt;
    if (options.memoryBlocks) {
      instructions = `${options.memoryBlocks}\n\n${instructions}`;
    }
    if (context.factsBlock) {
      instructions = `${context.factsBlock}\n\n${instructions}`;
    }

    // Build LLM request
    const llmRequest: LLMRequest = {
      messages: context.messages,
      instructions,
      model: model.id,
      params: {
        temperature: options.temperature,
        topP: options.topP,
        maxCompletionTokens: options.maxCompletionTokens,
        reasoningEffort: options.reasoningEffort,
        reasoningSummary: options.reasoningSummary,
        stream: options.useStreaming,
      },
    };

    let response: LLMResponse;
    let rawResponse: unknown;

    if (options.useStreaming) {
      let responseText = "";
      let finalResponse: LLMResponse | undefined;

      for await (const event of this.llmClient.stream(llmRequest)) {
        if (event.type === "delta") {
          responseText += event.text;
          options.onDelta?.(event.text);
        } else if (event.type === "reasoning_summary") {
          options.onReasoningSummary?.(event.text);
        } else if (event.type === "done") {
          finalResponse = event.response;
          rawResponse = event.rawResponse;
        }
      }

      response = finalResponse ?? { content: responseText, inputTokens: 0, outputTokens: 0 };
    } else {
      const result = await this.llmClient.send(llmRequest);
      response = result;
      rawResponse = result.rawResponse;
    }

    // Save assistant message
    if (response.content) {
      this.messageRepo.add(sessionId, "assistant", response.content);
    }

    // Calculate cost
    const costInfo = this.costService.calculate(model, response.inputTokens, response.outputTokens);

    return { response, costInfo, model, rawResponse };
  }
}
