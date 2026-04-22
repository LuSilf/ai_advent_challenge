import { Bot } from "grammy";
import type { LLMClient } from "../../domain/ports/llm-client";
import type { LLMRequest } from "../../domain/models";
import { WhitelistGuard } from "./whitelist";

export type TelegramWiringDeps = {
  botToken: string;
  whitelist: WhitelistGuard;
  llmClient: LLMClient;
  model: string;
};

export function createTelegramBot(deps: TelegramWiringDeps): Bot {
  const bot = new Bot(deps.botToken);

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "Привет! Я работаю на локальной LLM через Ollama. Пиши любое сообщение — отвечу.\n\nКоманды:\n/new — сбросить историю (появится в следующей фазе)",
    );
  });

  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id;
    if (!deps.whitelist.isAllowed(chatId)) {
      console.warn(
        `[telegram] rejected chat_id=${chatId} username=${ctx.from?.username ?? "(none)"} preview=${JSON.stringify(ctx.message.text.slice(0, 60))}`,
      );
      await ctx.reply("Этот бот приватный.");
      return;
    }

    try {
      await ctx.replyWithChatAction("typing");

      const request: LLMRequest = {
        messages: [],
        instructions: "",
        model: deps.model,
        params: {},
      };
      // single user-turn: pass as userPrompt path through empty history
      request.messages = [
        { id: 0, sessionId: 0, role: "user", content: ctx.message.text, createdAt: "" },
      ];

      const result = await deps.llmClient.send(request);
      const answer = result.content?.trim() || "(пустой ответ)";
      await ctx.reply(answer);
    } catch (err) {
      const message = explainError(err);
      console.error("[telegram] inference error", err);
      await ctx.reply(message);
    }
  });

  return bot;
}

function explainError(err: unknown): string {
  if (typeof err === "object" && err !== null) {
    const name = (err as { name?: unknown }).name;
    const code = (err as { code?: unknown }).code;
    const status = (err as { status?: unknown }).status;
    const message = typeof (err as { message?: unknown }).message === "string" ? (err as { message: string }).message : String(err);

    if (name === "AbortError" || code === "ETIMEDOUT" || /timeout/i.test(message)) {
      return "Модель думает слишком долго. Попробуйте ещё раз.";
    }
    if (code === "ECONNREFUSED" || code === "ECONNRESET" || /fetch failed|ECONNREFUSED/i.test(message)) {
      return "Модель недоступна. Убедитесь, что Ollama запущена.";
    }
    if (typeof status === "number" && status === 404) {
      return "Модель не найдена. Проверьте TELEGRAM_MODEL и что она загружена в Ollama.";
    }
    return `Ошибка: ${message}`;
  }
  return `Ошибка: ${String(err)}`;
}
