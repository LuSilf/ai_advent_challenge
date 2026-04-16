import type { CostInfo, LLMRequest, LLMResponse, LLMToolDefinition, LLMToolCall, Model, Message, ResponseFormat } from "../models";
import type { LLMClient, StreamEvent } from "../ports/llm-client";
import type { MessageRepository } from "../ports/message-repository";
import type { FactRepository } from "../ports/fact-repository";
import type { ModelRepository } from "../ports/model-repository";
import type { SessionService } from "./session-service";
import type { ContextService, ContextResult } from "./context-service";
import type { CostService } from "./cost-service";
import type { ProfileService } from "./profile-service";

export type ToolProvider = {
  getToolDefinitions(): LLMToolDefinition[];
  callTool(name: string, args: Record<string, unknown>): Promise<{ content: string; isError: boolean }>;
};

export type ToolCallEvent = {
  toolName: string;
  serverName: string;
  description: string;
  arguments: Record<string, unknown>;
  result?: string;
  isError?: boolean;
};

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
  userPromptSuffix?: string;
  responseFormat?: ResponseFormat;
  toolProvider?: ToolProvider;
  onToolCall?: (event: ToolCallEvent) => void;
  maxToolRounds?: number;
};

export type SendMessageResult = {
  response: LLMResponse;
  costInfo: CostInfo | null;
  model: Model;
  rawResponse?: unknown;
};

const DEFAULT_MAX_TOOL_ROUNDS = 20;

export class ChatService {
  constructor(
    private readonly llmClient: LLMClient,
    private readonly sessionService: SessionService,
    private readonly contextService: ContextService,
    private readonly costService: CostService,
    private readonly messageRepo: MessageRepository,
    private readonly factRepo: FactRepository,
    private readonly modelRepo: ModelRepository,
    private readonly profileService?: ProfileService,
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

    // Добавляем профиль в system prompt
    if (this.profileService) {
      const activeProfile = this.profileService.getActiveProfile();
      if (activeProfile) {
        const profileBlock = this.profileService.buildProfileBlock(activeProfile);
        instructions = `${profileBlock}\n\n${instructions}`;
      }
    }

    if (options.memoryBlocks) {
      instructions = `${options.memoryBlocks}\n\n${instructions}`;
    }
    if (context.factsBlock) {
      instructions = `${context.factsBlock}\n\n${instructions}`;
    }

    // Добавляем текущее сообщение пользователя в контекст
    const llmUserContent = options.userPromptSuffix
      ? `${userPrompt}\n\n${options.userPromptSuffix}`
      : userPrompt;
    const allMessages: Message[] = [
      ...context.messages,
      { id: 0, sessionId, role: "user" as const, content: llmUserContent, createdAt: "" },
    ];

    // Получаем tools
    const tools = options.toolProvider?.getToolDefinitions();
    const hasTools = tools && tools.length > 0;

    // Build LLM request
    const llmRequest: LLMRequest = {
      messages: allMessages,
      instructions,
      model: model.id,
      params: {
        temperature: options.temperature,
        topP: options.topP,
        maxCompletionTokens: options.maxCompletionTokens,
        reasoningEffort: options.reasoningEffort,
        reasoningSummary: options.reasoningSummary,
        stream: hasTools ? false : (options.useStreaming ?? false),
      },
      tools: hasTools ? tools : undefined,
      responseFormat: options.responseFormat,
    };

    // Если есть tools — запускаем tool-use loop (без стриминга)
    if (hasTools && options.toolProvider) {
      return this.sendWithToolLoop(sessionId, llmRequest, model, options);
    }

    // Обычный путь (без tools)
    return this.sendSimple(sessionId, llmRequest, model, options);
  }

  private async sendSimple(
    sessionId: number,
    llmRequest: LLMRequest,
    model: Model,
    options: SendMessageOptions,
  ): Promise<SendMessageResult> {
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

  private async sendWithToolLoop(
    sessionId: number,
    llmRequest: LLMRequest,
    model: Model,
    options: SendMessageOptions,
  ): Promise<SendMessageResult> {
    const maxRounds = options.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
    const toolProvider = options.toolProvider!;

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let currentMessages = [...llmRequest.messages];
    let rawResponse: unknown;

    for (let round = 0; round < maxRounds; round++) {
      const request: LLMRequest = {
        ...llmRequest,
        messages: currentMessages,
        params: { ...llmRequest.params, stream: false },
      };

      const result = await this.llmClient.send(request);
      totalInputTokens += result.inputTokens;
      totalOutputTokens += result.outputTokens;
      rawResponse = result.rawResponse;

      // Нет tool calls — финальный текстовый ответ
      if (!result.toolCalls || result.toolCalls.length === 0) {
        if (result.content) {
          this.messageRepo.add(sessionId, "assistant", result.content);
        }

        const costInfo = this.costService.calculate(model, totalInputTokens, totalOutputTokens);
        return {
          response: { content: result.content, inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
          costInfo,
          model,
          rawResponse,
        };
      }

      // Обрабатываем tool calls
      for (const toolCall of result.toolCalls) {
        let parsedArgs: Record<string, unknown>;
        try {
          parsedArgs = JSON.parse(toolCall.arguments);
        } catch {
          parsedArgs = {};
        }

        // Уведомляем UI
        options.onToolCall?.({
          toolName: toolCall.name,
          serverName: this.extractServerName(toolCall.name),
          description: this.findToolDescription(toolCall.name, llmRequest.tools ?? []),
          arguments: parsedArgs,
        });

        // Вызываем tool
        const toolResult = await toolProvider.callTool(toolCall.name, parsedArgs);

        // Уведомляем UI с результатом
        options.onToolCall?.({
          toolName: toolCall.name,
          serverName: this.extractServerName(toolCall.name),
          description: this.findToolDescription(toolCall.name, llmRequest.tools ?? []),
          arguments: parsedArgs,
          result: toolResult.content,
          isError: toolResult.isError,
        });

        // Добавляем tool call + result в контекст для следующего запроса
        currentMessages = [
          ...currentMessages,
          { id: 0, sessionId: 0, role: "assistant" as const, content: `[Tool call: ${toolCall.name}(${toolCall.arguments})]`, createdAt: "" },
          { id: 0, sessionId: 0, role: "user" as const, content: `[Tool result for ${toolCall.name}]: ${toolResult.content}`, createdAt: "" },
        ];
      }
    }

    // Лимит итераций достигнут — финальный запрос без tools
    const finalRequest: LLMRequest = {
      ...llmRequest,
      messages: [
        ...currentMessages,
        { id: 0, sessionId: 0, role: "user" as const, content: "Лимит вызовов инструментов достигнут. Дай финальный ответ на основе имеющихся данных.", createdAt: "" },
      ],
      tools: undefined,
      params: { ...llmRequest.params, stream: false },
    };

    const finalResult = await this.llmClient.send(finalRequest);
    totalInputTokens += finalResult.inputTokens;
    totalOutputTokens += finalResult.outputTokens;

    if (finalResult.content) {
      this.messageRepo.add(sessionId, "assistant", finalResult.content);
    }

    const costInfo = this.costService.calculate(model, totalInputTokens, totalOutputTokens);
    return {
      response: { content: finalResult.content, inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
      costInfo,
      model,
      rawResponse: finalResult.rawResponse,
    };
  }

  private extractServerName(toolName: string): string {
    const sep = toolName.indexOf("__");
    return sep >= 0 ? toolName.slice(0, sep) : "";
  }

  private findToolDescription(toolName: string, tools: LLMToolDefinition[]): string {
    return tools.find((t) => t.name === toolName)?.description ?? "";
  }
}
