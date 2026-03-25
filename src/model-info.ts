export type ModelInfo = {
  contextLength: number;
  inputPrice: number;
  outputPrice: number;
  /** Сырые данные из API (null если запрос не удался или модель не найдена) */
  raw: OpenRouterModel | null;
};

const DEFAULT_CONTEXT_LENGTH = 128_000;
const DEFAULT_INPUT_PRICE = 0;
const DEFAULT_OUTPUT_PRICE = 0;

type OpenRouterModel = {
  id: string;
  name?: string;
  context_length?: number;
  top_provider?: {
    max_completion_tokens?: number;
    is_moderated?: boolean;
  };
  pricing?: {
    prompt?: string;
    completion?: string;
    image?: string;
    request?: string;
  };
  architecture?: {
    modality?: string;
    tokenizer?: string;
    instruct_type?: string;
  };
  per_request_limits?: Record<string, string> | null;
};

export async function fetchModelInfo(modelId: string, baseUrl: string, apiKey: string): Promise<ModelInfo> {
  const envContextLength = process.env.OPENAI_MAX_CONTEXT_TOKENS;
  const envInputPrice = process.env.OPENAI_INPUT_PRICE;
  const envOutputPrice = process.env.OPENAI_OUTPUT_PRICE;

  // Если все три env-переопределения заданы, не делаем запрос
  if (envContextLength && envInputPrice && envOutputPrice) {
    return {
      contextLength: Number(envContextLength),
      inputPrice: Number(envInputPrice),
      outputPrice: Number(envOutputPrice),
      raw: null,
    };
  }

  let rawModel: OpenRouterModel | null = null;

  try {
    // OpenRouter API: baseUrl уже содержит /api/v1
    const modelsUrl = baseUrl.replace(/\/$/, "") + "/models";
    const response = await fetch(modelsUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const data = (await response.json()) as { data?: OpenRouterModel[] };
      rawModel = data.data?.find((m) => m.id === modelId) ?? null;
    }
  } catch {
    // Не блокируем работу при ошибке сети
  }

  const fetchedContextLength = rawModel?.context_length ?? undefined;
  const fetchedInputPrice = rawModel?.pricing?.prompt ? Number(rawModel.pricing.prompt) : undefined;
  const fetchedOutputPrice = rawModel?.pricing?.completion ? Number(rawModel.pricing.completion) : undefined;

  return {
    contextLength: envContextLength ? Number(envContextLength) : fetchedContextLength ?? DEFAULT_CONTEXT_LENGTH,
    inputPrice: envInputPrice ? Number(envInputPrice) : fetchedInputPrice ?? DEFAULT_INPUT_PRICE,
    outputPrice: envOutputPrice ? Number(envOutputPrice) : fetchedOutputPrice ?? DEFAULT_OUTPUT_PRICE,
    raw: rawModel,
  };
}
