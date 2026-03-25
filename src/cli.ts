import OpenAI from "openai";
import type { Response } from "openai/resources/responses/responses";

import { loadConfig } from "./config";
import { printOutputMarker, printRequestDebug, printResponseDebug } from "./debug-logger";
import { buildResponseRequest } from "./request";
import { initDb, createSession, getMessages, addMessage, getSession, getMessageCount, updateSessionTitle, saveTokenUsage, getSessionTokenTotals, getExchangeCount } from "./db";
import { startRepl } from "./repl";
import { fetchModelInfo } from "./model-info";
import { formatCompactTokenLine } from "./token-display";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function getHttpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return undefined;
  }

  const status = Number((error as { status?: number }).status);
  return Number.isFinite(status) ? status : undefined;
}

function isContextOverflowError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("context length") || lower.includes("maximum context") || lower.includes("token limit") || lower.includes("too many tokens");
}

function isTimeoutError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  if ("name" in error && error.name === "AbortError") {
    return true;
  }

  if (!("message" in error) || typeof error.message !== "string") {
    return false;
  }

  return error.message.toLowerCase().includes("timed out");
}

const config = loadConfig(Bun.argv.slice(2), fail);

initDb(config.historyDb);

const client = new OpenAI({
  apiKey: config.apiKey,
  baseURL: config.baseUrl,
  timeout: config.effectiveTimeoutMs,
  maxRetries: 0
});

// Получаем метаданные модели
const modelInfo = await fetchModelInfo(config.model, config.baseUrl, config.apiKey);
config.contextLength = modelInfo.contextLength;
config.inputPrice = modelInfo.inputPrice;
config.outputPrice = modelInfo.outputPrice;
config.modelRaw = modelInfo.raw;

// REPL-режим: без промпта
if (!config.prompt) {
  await startRepl(client, config);
} else {
  // Одиночный режим
  let sessionId: number;

  if (config.sessionId) {
    const session = getSession(config.sessionId);
    if (!session) {
      fail(`Сессия #${config.sessionId} не найдена`);
    }
    sessionId = config.sessionId;
  } else {
    sessionId = createSession();
  }

  const history = getMessages(sessionId, config.historyLimit).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content
  }));

  addMessage(sessionId, "user", config.prompt);

  if (config.debug) {
    printRequestDebug(config);
  }

  try {
    const request = buildResponseRequest(config, history);
    const startedAtMs = Date.now();

    let wroteOutputNewline = false;
    let responseText = "";
    let completedResponseRef: Response | undefined;

    if (config.useStreaming) {
      const stream = await client.responses.create({ ...request, stream: true });

      let hasOutput = false;
      let completedResponse: Response | undefined;
      const reasoningSummaryParts: string[] = [];

      if (config.debug) {
        printOutputMarker();
      }

      for await (const event of stream) {
        if (event.type === "response.output_text.delta" && event.delta.length > 0) {
          process.stdout.write(event.delta);
          responseText += event.delta;
          hasOutput = true;
        }

        if (event.type === "response.reasoning_summary_text.done") {
          const text = event.text.trim();
          if (text) {
            reasoningSummaryParts.push(text);
          }
        }

        if (event.type === "response.completed") {
          completedResponse = event.response;
        }
      }

      if (!hasOutput && completedResponse?.output_text) {
        responseText = completedResponse.output_text;
        process.stdout.write(responseText);
        hasOutput = true;
      }

      if (!hasOutput) {
        fail("No text content found in model response");
      }

      if (config.debug && completedResponse) {
        process.stdout.write("\n");
        wroteOutputNewline = true;
        printResponseDebug(completedResponse, startedAtMs, reasoningSummaryParts);
      }

      completedResponseRef = completedResponse;
    } else {
      const response = await client.responses.create({ ...request, stream: false });

      responseText = response.output_text ?? "";

      if (typeof responseText !== "string" || responseText.length === 0) {
        fail("No text content found in model response");
      }

      if (config.debug) {
        printOutputMarker();
      }

      process.stdout.write(responseText);

      if (config.debug) {
        process.stdout.write("\n");
        wroteOutputNewline = true;
        printResponseDebug(response, startedAtMs);
      }

      completedResponseRef = response;
    }

    if (responseText) {
      addMessage(sessionId, "assistant", responseText);

      // Сохраняем usage
      if (completedResponseRef?.usage) {
        const usage = completedResponseRef.usage;
        const exchangeNum = getExchangeCount(sessionId) + 1;
        const inputCost = usage.input_tokens * config.inputPrice;
        const outputCost = usage.output_tokens * config.outputPrice;

        saveTokenUsage(sessionId, {
          exchangeNum,
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          cachedTokens: usage.input_tokens_details.cached_tokens,
          reasoningTokens: usage.output_tokens_details.reasoning_tokens,
          totalTokens: usage.total_tokens,
          inputCost,
          outputCost,
          totalCost: inputCost + outputCost,
        });

        const totals = getSessionTokenTotals(sessionId);
        if (!wroteOutputNewline) {
          process.stdout.write("\n");
          wroteOutputNewline = true;
        }
        console.log(formatCompactTokenLine(
          usage.input_tokens,
          usage.output_tokens,
          totals.totalTokens,
          config.contextLength,
          totals.totalCost,
        ));
      }

      // Автоименование
      const session = getSession(sessionId);
      if (session && !session.title && getMessageCount(sessionId) === 2) {
        try {
          const titleResponse = await client.responses.create({
            model: config.titleModel,
            instructions:
              "Придумай короткое название (до 50 символов) для диалога по первому обмену сообщениями. Ответь только названием, без кавычек.",
            input: `Пользователь: ${config.prompt}\nАссистент: ${responseText}`,
            stream: false
          });
          const title = titleResponse.output_text?.trim();
          if (title) {
            updateSessionTitle(sessionId, title);
          }
        } catch {
          // не блокируем основной поток
        }
      }
    }

    if (!wroteOutputNewline) {
      process.stdout.write("\n");
    }
    process.exit(0);
  } catch (error) {
    const status = getHttpStatus(error);

    if (isTimeoutError(error)) {
      console.error(`Request timed out after ${config.effectiveTimeoutMs}ms`);
      console.error("Check OPENAI_BASE_URL and network connectivity");
      process.exit(1);
    }

    if (status === 429) {
      console.error("Rate limit reached (HTTP 429)");
      console.error("Switch model/provider or wait before the next request");
      console.error("Also check account quota/credits on the provider side");
      process.exit(1);
    }

    // Обработка переполнения контекста
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (isContextOverflowError(errorMessage)) {
      const totals = getSessionTokenTotals(sessionId);
      console.error("⚠️  Превышен лимит контекста модели!");
      console.error(`   Текущий размер: ~${totals.totalTokens} токенов`);
      console.error(`   Лимит модели: ${config.contextLength} токенов`);
      console.error("   Рекомендация: начните новую сессию (/new) или очистите историю (/clear)");
      process.exit(1);
    }

    console.error("LLM request failed");
    console.error(errorMessage);
    process.exit(1);
  }
}
