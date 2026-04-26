import { encode } from "gpt-tokenizer";

// Per-message overhead in OpenAI's chat format ≈ 4 tokens (role/format wrappers).
// Plus 2 tokens to prime an assistant reply. See OpenAI cookbook.
export const MESSAGE_OVERHEAD_TOKENS = 4;
export const REPLY_PRIMER_TOKENS = 2;

export type CountableMessage = {
  role: string;
  content?: string | null;
};

export class TokenCounter {
  countMessages(messages: ReadonlyArray<CountableMessage>): number {
    let total = REPLY_PRIMER_TOKENS;
    for (const m of messages) {
      total += MESSAGE_OVERHEAD_TOKENS;
      const content = typeof m.content === "string" ? m.content : "";
      if (content.length > 0) {
        total += encode(content).length;
      }
      if (typeof m.role === "string" && m.role.length > 0) {
        total += encode(m.role).length;
      }
    }
    return total;
  }
}
