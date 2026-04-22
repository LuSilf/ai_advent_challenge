export type ChatRole = "user" | "assistant";

export type ChatTurn = {
  role: ChatRole;
  content: string;
};

export type ChatHistoryOptions = {
  maxTurnsPerChat?: number;
};

const DEFAULT_MAX_TURNS = 40;

export class ChatHistoryStore {
  private readonly store = new Map<number, ChatTurn[]>();
  private readonly maxTurnsPerChat: number;

  constructor(options: ChatHistoryOptions = {}) {
    this.maxTurnsPerChat = options.maxTurnsPerChat ?? DEFAULT_MAX_TURNS;
  }

  append(chatId: number, role: ChatRole, content: string): void {
    const turns = this.store.get(chatId) ?? [];
    turns.push({ role, content });
    if (turns.length > this.maxTurnsPerChat) {
      turns.splice(0, turns.length - this.maxTurnsPerChat);
    }
    this.store.set(chatId, turns);
  }

  get(chatId: number): ChatTurn[] {
    return this.store.get(chatId)?.slice() ?? [];
  }

  clear(chatId: number): void {
    this.store.delete(chatId);
  }
}
