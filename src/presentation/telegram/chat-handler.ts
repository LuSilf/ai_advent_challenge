import type { LLMClient } from "../../domain/ports/llm-client";
import type { LLMRequest, Message } from "../../domain/models";
import type { ChatHistoryStore } from "./history";

export type TelegramChatHandlerDeps = {
  llmClient: LLMClient;
  history: ChatHistoryStore;
  model: string;
  systemPrompt?: string;
  maxCompletionTokens?: number;
};

export class TelegramChatHandler {
  constructor(private readonly deps: TelegramChatHandlerDeps) {}

  async handleMessage(chatId: number, text: string): Promise<string> {
    this.deps.history.append(chatId, "user", text);

    const turns = this.deps.history.get(chatId);
    const messages: Message[] = turns.map((turn, index) => ({
      id: index,
      sessionId: chatId,
      role: turn.role,
      content: turn.content,
      createdAt: "",
    }));

    const request: LLMRequest = {
      messages,
      instructions: this.deps.systemPrompt ?? "",
      model: this.deps.model,
      params: {
        maxCompletionTokens: this.deps.maxCompletionTokens,
      },
    };

    const result = await this.deps.llmClient.send(request);
    const answer = result.content?.trim() || "";

    if (answer) {
      this.deps.history.append(chatId, "assistant", answer);
    }

    return answer;
  }

  clearHistory(chatId: number): void {
    this.deps.history.clear(chatId);
  }
}
