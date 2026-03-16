import OpenAI from "openai";

const prompt = Bun.argv.slice(2).join(" ").trim();

const DEFAULT_SYSTEM_PROMPT = `You are a poetic assistant.
All responses must be written as poetry in Russian.

Poetry specification:

Language: Russian
Poetic form: two quatrains (2 stanzas, 4 lines each)
Meter: iambic tetrameter
Rhyme scheme: ABAB
Line length: approximately 8–9 syllables
Rhythm: strict and consistent
Style: humorous
Lexicon: elevated / high literary vocabulary

Rules:

* The response must contain exactly two quatrains.
* Maintain a clear rhyme scheme ABAB in each quatrain.
* Preserve a consistent iambic rhythm across lines.
* Use humorous imagery or witty tone.
* Use elevated vocabulary and literary expressions.
* Do not include prose explanations or commentary.
* If the structure or rhythm breaks, rewrite the poem internally before answering.`;

if (!prompt) {
  console.error("Usage: bun run src/cli.ts \"Your prompt\"");
  process.exit(1);
}

const apiKeyEnvName = process.env.OPENAI_API_KEY_ENV?.trim();
const apiKey = process.env.OPENAI_API_KEY?.trim() || (apiKeyEnvName ? process.env[apiKeyEnvName]?.trim() : undefined);
const model = process.env.OPENAI_MODEL;
const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
const systemPrompt = process.env.OPENAI_SYSTEM_PROMPT ?? DEFAULT_SYSTEM_PROMPT;
const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS ?? "30000");
const debug = process.env.OPENAI_DEBUG === "1";
const effectiveTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30000;
const disableThinking = /gpt-5/i.test(model ?? "");

if (!apiKey) {
  console.error("Missing API key. Set OPENAI_API_KEY or OPENAI_API_KEY_ENV");
  process.exit(1);
}

if (!model) {
  console.error("Missing OPENAI_MODEL environment variable");
  process.exit(1);
}

const messages: Array<{ role: "system" | "user"; content: string }> = [{ role: "system", content: systemPrompt }];

messages.push({ role: "user", content: prompt });

const endpoint = `${baseUrl}/chat/completions`;
const client = new OpenAI({
  apiKey,
  baseURL: baseUrl,
  timeout: effectiveTimeoutMs,
  maxRetries: 0
});

if (debug) {
  console.error(`Requesting: ${endpoint}`);
  console.error(`Model: ${model}`);
  console.error(`Timeout: ${effectiveTimeoutMs}ms`);
  if (disableThinking) {
    console.error("Thinking: minimal");
  }
  console.error("Messages:");
  for (const message of messages) {
    console.error(`[${message.role}]`);
    console.error(message.content);
  }
}

try {
  const request: Parameters<typeof client.chat.completions.create>[0] = {
    model,
    messages,
    stream: true
  };

  if (disableThinking) {
    (request as Record<string, unknown>).reasoning_effort = "minimal";
  }

  const stream = await client.chat.completions.create(request);

  let hasOutput = false;

  for await (const chunk of stream) {
    const content = chunk.choices?.[0]?.delta?.content;

    if (typeof content === "string" && content.length > 0) {
      process.stdout.write(content);
      hasOutput = true;
    }
  }

  if (!hasOutput) {
    console.error("No text content found in model response");
    process.exit(1);
  }

  process.stdout.write("\n");
  process.exit(0);
} catch (error) {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: number }).status)
      : undefined;

  if ((error as Error).name === "AbortError" || (error instanceof Error && error.message.toLowerCase().includes("timed out"))) {
    console.error(`Request timed out after ${effectiveTimeoutMs}ms`);
    console.error("Check OPENAI_BASE_URL and network connectivity");
    process.exit(1);
  }

  if (status === 429) {
    console.error("Rate limit reached (HTTP 429)");
    console.error("Switch model/provider or wait before the next request");
    console.error("Also check account quota/credits on the provider side");
    process.exit(1);
  }

  console.error("LLM request failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
