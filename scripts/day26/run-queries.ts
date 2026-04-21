import OpenAI from "openai";
import pc from "picocolors";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1";
const LOCAL_MODEL = "qwen2.5-coder:7b";

async function main(): Promise<void> {
  const client = new OpenAI({ baseURL: OLLAMA_BASE_URL, apiKey: "ollama" });

  console.log(pc.bold(`Target: ${LOCAL_MODEL} via ${OLLAMA_BASE_URL}`));

  const startedAt = performance.now();
  let response;
  try {
    response = await client.chat.completions.create({
      model: LOCAL_MODEL,
      messages: [{ role: "user", content: "Say 'ok' and nothing else" }],
      temperature: 0,
      seed: 42,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("ECONNREFUSED") || message.includes("fetch failed")) {
      console.error(pc.red(`Ollama недоступен на ${OLLAMA_BASE_URL}. Проверь, что ollama serve запущен.`));
    } else if (message.includes("not found") || message.includes("model")) {
      console.error(pc.red(`Модель ${LOCAL_MODEL} не найдена в Ollama. Сделай: ollama pull ${LOCAL_MODEL}`));
    } else {
      console.error(pc.red(`Ошибка: ${message}`));
    }
    process.exit(1);
  }
  const latencyMs = Math.round(performance.now() - startedAt);

  const answer = response.choices[0]?.message?.content ?? "";
  const promptTokens = response.usage?.prompt_tokens ?? 0;
  const completionTokens = response.usage?.completion_tokens ?? 0;

  console.log(pc.green("Response:"), answer);
  console.log(`Latency: ${latencyMs} ms`);
  console.log(`Prompt tokens: ${promptTokens}, Completion tokens: ${completionTokens}`);
}

main();
