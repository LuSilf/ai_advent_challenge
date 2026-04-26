export type ServerConfig = {
  host: string;
  port: number;
  ollamaBaseUrl: string;
  requestTimeoutMs: number;
  allowedModels: string[];
  apiKeys: Map<string, string>;
  rateLimitCapacity: number;
  rateLimitRefillPerSec: number;
};

const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_PORT = 8080;
const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_ALLOWED_MODELS = ["llama3.2:3b", "qwen2.5-coder:7b"];
const DEFAULT_RATE_CAPACITY = 10;
const DEFAULT_RATE_REFILL_PER_SEC = 1;

export type EnvReader = (name: string) => string | undefined;

export function loadServerConfig(env: EnvReader, fail: (message: string) => never): ServerConfig {
  const host = readString(env, "LLM_SERVICE_HOST") ?? DEFAULT_HOST;
  const port = readPort(env, "LLM_SERVICE_PORT", DEFAULT_PORT, fail);
  const ollamaBaseUrl = (readString(env, "OLLAMA_BASE_URL") ?? DEFAULT_OLLAMA_BASE_URL).replace(/\/$/, "");
  const requestTimeoutMs = readPositiveInt(env, "LLM_SERVICE_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, fail);
  const allowedModels = readAllowedModels(env, fail);
  const apiKeys = readApiKeys(env, fail);
  const rateLimitCapacity = readPositiveNumber(env, "LLM_SERVICE_RATE_CAPACITY", DEFAULT_RATE_CAPACITY, fail);
  const rateLimitRefillPerSec = readPositiveNumber(
    env,
    "LLM_SERVICE_RATE_REFILL_PER_SEC",
    DEFAULT_RATE_REFILL_PER_SEC,
    fail,
  );

  return {
    host,
    port,
    ollamaBaseUrl,
    requestTimeoutMs,
    allowedModels,
    apiKeys,
    rateLimitCapacity,
    rateLimitRefillPerSec,
  };
}

function readPositiveNumber(env: EnvReader, name: string, defaultValue: number, fail: (message: string) => never): number {
  const raw = readString(env, name);
  if (!raw) return defaultValue;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    fail(`Invalid ${name} value: ${raw}. Must be a positive number.`);
  }
  return parsed;
}

function readApiKeys(env: EnvReader, fail: (message: string) => never): Map<string, string> {
  const raw = readString(env, "LLM_SERVICE_API_KEYS");
  if (!raw) {
    fail("Missing required env: LLM_SERVICE_API_KEYS (format: keyId:secret,keyId:secret)");
  }
  const out = new Map<string, string>();
  for (const part of raw.split(",")) {
    const token = part.trim();
    if (!token) continue;
    const colonIdx = token.indexOf(":");
    if (colonIdx === -1) {
      fail(`Invalid LLM_SERVICE_API_KEYS entry "${token}": missing ':' separator (expected keyId:secret).`);
    }
    const keyId = token.slice(0, colonIdx).trim();
    const secret = token.slice(colonIdx + 1).trim();
    if (!keyId) {
      fail(`Invalid LLM_SERVICE_API_KEYS entry "${token}": empty keyId.`);
    }
    if (!secret) {
      fail(`Invalid LLM_SERVICE_API_KEYS entry "${token}": empty secret.`);
    }
    if (out.has(keyId)) {
      fail(`Invalid LLM_SERVICE_API_KEYS: duplicate keyId "${keyId}".`);
    }
    out.set(keyId, secret);
  }
  if (out.size === 0) {
    fail("Invalid LLM_SERVICE_API_KEYS: no valid keys parsed.");
  }
  return out;
}

function readAllowedModels(env: EnvReader, fail: (message: string) => never): string[] {
  const raw = readString(env, "LLM_SERVICE_ALLOWED_MODELS");
  if (!raw) return [...DEFAULT_ALLOWED_MODELS];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const token = part.trim();
    if (!token) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  if (out.length === 0) {
    fail("Invalid LLM_SERVICE_ALLOWED_MODELS value: list is empty after parsing.");
  }
  return out;
}

function readString(env: EnvReader, name: string): string | undefined {
  const raw = env(name);
  if (raw === undefined || raw === null) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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

function readPort(env: EnvReader, name: string, defaultValue: number, fail: (message: string) => never): number {
  const raw = readString(env, name);
  if (!raw) return defaultValue;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    fail(`Invalid ${name} value: ${raw}. Must be an integer in 1..65535.`);
  }
  return parsed;
}
