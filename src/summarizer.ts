import type OpenAI from "openai";
import type { ChatMessage } from "./request";

const SUMMARIZE_PROMPT = `Ты — система сжатия контекста. Твоя задача — создать или обновить краткое фактологическое резюме диалога.

Правила:
- Сохраняй все ключевые факты, решения, имена, числа и контекст
- Пиши сжато, без воды, в формате тезисов
- Если предоставлено предыдущее резюме — дополни его новой информацией, не дублируя
- Не добавляй своих выводов или интерпретаций
- Пиши на том же языке, что и диалог`;

export async function generateSummary(
  client: OpenAI,
  model: string,
  existingSummary: string | null,
  messages: ChatMessage[]
): Promise<string> {
  const messagesText = messages
    .map((m) => `${m.role === "user" ? "Пользователь" : "Ассистент"}: ${m.content}`)
    .join("\n\n");

  let input: string;
  if (existingSummary) {
    input = `Предыдущее резюме:\n${existingSummary}\n\nНовые сообщения для включения в резюме:\n${messagesText}`;
  } else {
    input = `Сообщения для создания резюме:\n${messagesText}`;
  }

  const response = await client.responses.create({
    model,
    instructions: SUMMARIZE_PROMPT,
    input,
    stream: false
  });

  return response.output_text?.trim() || "";
}
