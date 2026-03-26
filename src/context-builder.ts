import type OpenAI from "openai";
import type { ChatMessage } from "./request";
import { getMessages, getMessageCount, getSummary, upsertSummary } from "./db";
import { generateSummary } from "./summarizer";

export type BuiltContext = {
  messages: ChatMessage[];
  summaryUsed: boolean;
};

export async function buildContext(
  client: OpenAI,
  model: string,
  sessionId: number,
  tailSize: number
): Promise<BuiltContext> {
  const totalCount = getMessageCount(sessionId);

  // Если сообщений не больше tailSize — отдаём все как есть
  if (totalCount <= tailSize) {
    const messages = getMessages(sessionId).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content
    }));
    return { messages, summaryUsed: false };
  }

  // Загружаем все сообщения и текущий summary
  const allMessages = getMessages(sessionId);
  const tail = allMessages.slice(-tailSize).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content
  }));

  const oldMessages = allMessages.slice(0, -tailSize);
  const summary = getSummary(sessionId);
  const alreadySummarized = summary?.message_count ?? 0;

  // Есть ли несжатые сообщения за горизонтом?
  if (oldMessages.length > alreadySummarized) {
    const unsummarized = oldMessages.slice(alreadySummarized).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content
    }));

    const newSummary = await generateSummary(
      client,
      model,
      summary?.content ?? null,
      unsummarized
    );

    upsertSummary(sessionId, newSummary, oldMessages.length);
    return {
      messages: [{ role: "user", content: newSummary }, ...tail],
      summaryUsed: true
    };
  }

  // Summary уже актуален
  if (summary) {
    return {
      messages: [{ role: "user", content: summary.content }, ...tail],
      summaryUsed: true
    };
  }

  // Не должно случиться, но на всякий случай
  return { messages: tail, summaryUsed: false };
}
