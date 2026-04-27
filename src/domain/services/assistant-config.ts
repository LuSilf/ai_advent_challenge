export type AssistantConfig = {
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  embeddingBaseUrl: string;
  embeddingModel: string;
  dbPath: string;
  topK: number;
  toolLoopMax: number;
  projectRoot: string;
};

export type EnvReader = (name: string) => string | undefined;

const DEFAULT_EMBEDDING_BASE_URL = "http://localhost:11434";
const DEFAULT_EMBEDDING_MODEL = "nomic-embed-text";
const DEFAULT_DB_PATH = "data/project-docs.db";
const DEFAULT_TOP_K = 5;
const DEFAULT_TOOL_LOOP_MAX = 5;

export function loadAssistantConfig(env: EnvReader, fail: (message: string) => never): AssistantConfig {
  const llmBaseUrl = readRequired(env, "ASSISTANT_LLM_BASE_URL", fail).replace(/\/$/, "");
  const llmApiKey = readRequired(env, "ASSISTANT_LLM_API_KEY", fail);
  const llmModel = readRequired(env, "ASSISTANT_LLM_MODEL", fail);

  const embeddingBaseUrl = (readOptional(env, "ASSISTANT_EMBEDDING_BASE_URL") ?? DEFAULT_EMBEDDING_BASE_URL).replace(
    /\/$/,
    "",
  );
  const embeddingModel = readOptional(env, "ASSISTANT_EMBEDDING_MODEL") ?? DEFAULT_EMBEDDING_MODEL;
  const dbPath = readOptional(env, "ASSISTANT_DB_PATH") ?? DEFAULT_DB_PATH;
  const topK = readBoundedInt(env, "ASSISTANT_TOP_K", DEFAULT_TOP_K, 1, 20, fail);
  const toolLoopMax = readBoundedInt(env, "ASSISTANT_TOOL_LOOP_MAX", DEFAULT_TOOL_LOOP_MAX, 1, 10, fail);
  const projectRoot = readOptional(env, "ASSISTANT_PROJECT_ROOT") ?? process.cwd();

  return {
    llmBaseUrl,
    llmApiKey,
    llmModel,
    embeddingBaseUrl,
    embeddingModel,
    dbPath,
    topK,
    toolLoopMax,
    projectRoot,
  };
}

function readOptional(env: EnvReader, name: string): string | undefined {
  const raw = env(name);
  if (raw === undefined || raw === null) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readRequired(env: EnvReader, name: string, fail: (message: string) => never): string {
  const value = readOptional(env, name);
  if (value === undefined) {
    fail(`Missing required env: ${name}. Set it in .env`);
  }
  return value;
}

function readBoundedInt(
  env: EnvReader,
  name: string,
  defaultValue: number,
  min: number,
  max: number,
  fail: (message: string) => never,
): number {
  const raw = readOptional(env, name);
  if (raw === undefined) return defaultValue;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    fail(`Invalid ${name} value: ${raw}. Must be an integer in ${min}..${max}.`);
  }
  return parsed;
}
