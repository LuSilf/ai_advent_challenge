import OpenAI from "openai";

import { OpenAILLMClient } from "./api/openai/llm-client";
import { WhitelistGuard } from "./presentation/telegram/whitelist";
import { createTelegramBot } from "./presentation/telegram";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    fail(`Missing required env: ${name}`);
  }
  return value;
}

const botToken = requireEnv("TELEGRAM_BOT_TOKEN");
const allowedCsv = requireEnv("TELEGRAM_ALLOWED_CHAT_IDS");
const model = process.env.TELEGRAM_MODEL?.trim() || "llama3.2:3b";
const baseUrl = (process.env.OPENAI_BASE_URL?.trim() || "http://localhost:11434/v1").replace(/\/$/, "");

let whitelist: WhitelistGuard;
try {
  whitelist = new WhitelistGuard(allowedCsv);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}

if (whitelist.size === 0) {
  fail("TELEGRAM_ALLOWED_CHAT_IDS must contain at least one chat_id");
}

const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY?.trim() || "ollama",
  baseURL: baseUrl,
  timeout: 180_000,
  maxRetries: 0,
});
const llmClient = new OpenAILLMClient(openaiClient);

const bot = createTelegramBot({
  botToken,
  whitelist,
  llmClient,
  model,
});

const shutdown = async (signal: string) => {
  console.log(`[telegram] received ${signal}, stopping…`);
  await bot.stop();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

console.log(`[telegram] starting long-polling against ${baseUrl} with model ${model}`);
console.log(`[telegram] whitelist size=${whitelist.size}`);

await bot.start();
