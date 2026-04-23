import OpenAI from "openai";

import { OpenAILLMClient } from "./api/openai/llm-client";
import { WhitelistGuard } from "./presentation/telegram/whitelist";
import { ChatHistoryStore } from "./presentation/telegram/history";
import { TelegramChatHandler } from "./presentation/telegram/chat-handler";
import { loadTelegramConfig } from "./presentation/telegram/config";
import { createTelegramBot } from "./presentation/telegram";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const config = loadTelegramConfig((name) => process.env[name], fail);

let whitelist: WhitelistGuard;
try {
  whitelist = new WhitelistGuard(config.allowedChatIdsCsv);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}

if (whitelist.size === 0) {
  fail("TELEGRAM_ALLOWED_CHAT_IDS must contain at least one chat_id");
}

const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY?.trim() || "ollama",
  baseURL: config.baseUrl,
  timeout: config.timeoutMs,
  maxRetries: 0,
});
const llmClient = new OpenAILLMClient(openaiClient);

const history = new ChatHistoryStore();
const chatHandler = new TelegramChatHandler({
  llmClient,
  history,
  model: config.model,
  systemPrompt: config.systemPrompt,
  maxCompletionTokens: config.maxCompletionTokens,
});

const bot = createTelegramBot({
  botToken: config.botToken,
  whitelist,
  chatHandler,
});

const shutdown = async (signal: string) => {
  console.log(`[telegram] received ${signal}, stopping…`);
  await bot.stop();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

console.log(`[telegram] starting long-polling against ${config.baseUrl} with model ${config.model}`);
console.log(`[telegram] whitelist size=${whitelist.size}, timeout=${config.timeoutMs}ms, max_tokens=${config.maxCompletionTokens}`);

await bot.start();
