import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "summarize",
  version: "1.0.0",
});

const MAX_INPUT_LENGTH = 12_000;

const SYSTEM_PROMPT = `Ты — суммаризатор. Получаешь текст и возвращаешь краткое содержание на русском языке. Будь лаконичен: 2-4 предложения. Если указан контекст (например, что это GitHub Pull Request), учитывай его при суммаризации.`;

type ChatCompletionResponse = {
  choices: Array<{
    message: { content: string };
  }>;
  error?: { message: string };
};

export async function callLLM(text: string, context?: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY не задан в environment");
  }

  const truncatedText = text.length > MAX_INPUT_LENGTH
    ? text.slice(0, MAX_INPUT_LENGTH) + "\n\n[...текст обрезан...]"
    : text;

  const userMessage = context
    ? `Контекст: ${context}\n\nТекст для суммаризации:\n${truncatedText}`
    : truncatedText;

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      temperature: 0.3,
      max_completion_tokens: 2048,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`LLM API ${resp.status}: ${body}`);
  }

  const data = (await resp.json()) as ChatCompletionResponse;

  if (data.error) {
    throw new Error(`LLM error: ${data.error.message}`);
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("LLM вернул пустой ответ");
  }

  return content.trim();
}

server.tool(
  "summarize",
  "Суммаризирует произвольный текст с помощью LLM. Возвращает краткое содержание на русском языке (2-4 предложения).",
  {
    text: z.string().describe("Текст для суммаризации"),
    context: z.string().optional().describe("Контекст, например 'GitHub Pull Request #12345'"),
  },
  async ({ text, context }) => {
    if (!text.trim()) {
      return {
        content: [{ type: "text", text: "Ошибка: пустой текст для суммаризации" }],
        isError: true,
      };
    }

    try {
      const summary = await callLLM(text, context);
      return { content: [{ type: "text", text: summary }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Ошибка суммаризации: ${(error as Error).message}` }],
        isError: true,
      };
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
