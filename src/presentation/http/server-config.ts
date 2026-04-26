export type ServerConfig = {
  host: string;
  port: number;
  ollamaBaseUrl: string;
  requestTimeoutMs: number;
};

const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_PORT = 8080;
const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
const DEFAULT_TIMEOUT_MS = 180_000;

export type EnvReader = (name: string) => string | undefined;

export function loadServerConfig(env: EnvReader, fail: (message: string) => never): ServerConfig {
  const host = readString(env, "LLM_SERVICE_HOST") ?? DEFAULT_HOST;
  const port = readPort(env, "LLM_SERVICE_PORT", DEFAULT_PORT, fail);
  const ollamaBaseUrl = (readString(env, "OLLAMA_BASE_URL") ?? DEFAULT_OLLAMA_BASE_URL).replace(/\/$/, "");
  const requestTimeoutMs = readPositiveInt(env, "LLM_SERVICE_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, fail);

  return { host, port, ollamaBaseUrl, requestTimeoutMs };
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
