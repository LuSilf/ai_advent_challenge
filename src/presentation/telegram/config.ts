export type TelegramConfig = {
  botToken: string;
  allowedChatIdsCsv: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  maxCompletionTokens: number;
  systemPrompt: string;
};

const DEFAULT_MODEL = "llama3.2:3b";
const DEFAULT_BASE_URL = "http://localhost:11434/v1";
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_MAX_TOKENS = 768;
const DEFAULT_SYSTEM_PROMPT =
  "Ты краткий русскоязычный ассистент. Отвечай по делу, без воды и markdown-форматирования. Держись в пределах ~300 слов.";

export type EnvReader = (name: string) => string | undefined;

export function loadTelegramConfig(env: EnvReader, fail: (message: string) => never): TelegramConfig {
  const botToken = requireString(env, "TELEGRAM_BOT_TOKEN", fail);
  const allowedChatIdsCsv = requireString(env, "TELEGRAM_ALLOWED_CHAT_IDS", fail);

  const model = readString(env, "TELEGRAM_MODEL") ?? DEFAULT_MODEL;
  const baseUrl = (readString(env, "TELEGRAM_BASE_URL") ?? DEFAULT_BASE_URL).replace(/\/$/, "");

  const timeoutMs = readPositiveInt(env, "TELEGRAM_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, fail);
  const maxCompletionTokens = readPositiveInt(env, "TELEGRAM_MAX_TOKENS", DEFAULT_MAX_TOKENS, fail);

  const systemPrompt = readString(env, "TELEGRAM_SYSTEM_PROMPT") ?? DEFAULT_SYSTEM_PROMPT;

  return {
    botToken,
    allowedChatIdsCsv,
    model,
    baseUrl,
    timeoutMs,
    maxCompletionTokens,
    systemPrompt,
  };
}

function readString(env: EnvReader, name: string): string | undefined {
  const raw = env(name);
  if (raw === undefined || raw === null) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function requireString(env: EnvReader, name: string, fail: (message: string) => never): string {
  const value = readString(env, name);
  if (!value) {
    fail(`Missing required env: ${name}`);
  }
  return value;
}

function readPositiveInt(env: EnvReader, name: string, defaultValue: number, fail: (message: string) => never): number {
  const raw = readString(env, name);
  if (!raw) return defaultValue;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    fail(`Invalid ${name} value: ${raw}. Must be a positive integer.`);
  }
  return parsed;
}
