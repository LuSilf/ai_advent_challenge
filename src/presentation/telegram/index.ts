import { Bot } from "grammy";
import type { TelegramChatHandler } from "./chat-handler";
import type { WhitelistGuard } from "./whitelist";

export type TelegramWiringDeps = {
  botToken: string;
  whitelist: WhitelistGuard;
  chatHandler: TelegramChatHandler;
};

export function createTelegramBot(deps: TelegramWiringDeps): Bot {
  const bot = new Bot(deps.botToken);

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "Привет! Я работаю на локальной LLM через Ollama. Пиши любое сообщение — отвечу.\n\nКоманды:\n/new — сбросить историю и начать сначала",
    );
  });

  bot.command("new", async (ctx) => {
    if (!deps.whitelist.isAllowed(ctx.chat.id)) {
      await ctx.reply("Этот бот приватный.");
      return;
    }
    deps.chatHandler.clearHistory(ctx.chat.id);
    await ctx.reply("История очищена. Начнём сначала.");
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
      const answer = await deps.chatHandler.handleMessage(chatId, ctx.message.text);
      await ctx.reply(answer || "(пустой ответ)");
    } catch (err) {
      const message = explainError(err);
      console.error("[telegram] inference error", err);
      await ctx.reply(message);
    }
  });

  return bot;
}

export function explainError(err: unknown): string {
  if (typeof err === "object" && err !== null) {
    const name = (err as { name?: unknown }).name;
    const code = (err as { code?: unknown }).code;
    const status = (err as { status?: unknown }).status;
    const message = typeof (err as { message?: unknown }).message === "string" ? (err as { message: string }).message : String(err);

    if (name === "AbortError" || code === "ETIMEDOUT" || /timeout/i.test(message)) {
      return "Модель думает слишком долго. Попробуйте ещё раз.";
    }
    if (
      name === "APIConnectionError" ||
      code === "ECONNREFUSED" ||
      code === "ECONNRESET" ||
      /connection error|fetch failed|ECONNREFUSED/i.test(message)
    ) {
      return "Модель недоступна. Убедитесь, что Ollama запущена.";
    }
    if (typeof status === "number" && status === 404) {
      return "Модель не найдена. Проверьте TELEGRAM_MODEL и что она загружена в Ollama.";
    }
    return `Ошибка: ${message}`;
  }
  return `Ошибка: ${String(err)}`;
}
