import OpenAI from "openai";
import type { Response } from "openai/resources/responses/responses";

import { loadConfig } from "./config";
import { printOutputMarker, printRequestDebug, printResponseDebug } from "./debug-logger";
import { buildResponseRequest } from "./request";
import { initDb, createSession, addMessage, getSession, getSessionStrategy, getMessageCount, updateSessionTitle, getFacts, upsertFacts, getModelForRole, calculateCost, formatCost } from "./db";
import { startRepl } from "./repl";
import { createStrategy, buildFactsExtractionInput, parseFactsResponse, FACTS_EXTRACTION_PROMPT } from "./strategy";

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
    sessionId = createSession(undefined, config.contextStrategy);
  }

  const strategyName = getSessionStrategy(sessionId);
  const strategy = createStrategy(strategyName);
  const { messages: history, factsBlock } = strategy.buildMessages(sessionId, config.historyLimit);

  addMessage(sessionId, "user", config.prompt);

  const chatModel = getModelForRole("chat");
  const modelId = chatModel?.id ?? "openai/gpt-5-nano";

  if (config.debug) {
    printRequestDebug(config, modelId);
  }

  try {
    const request = buildResponseRequest(config, modelId, history, factsBlock);
    const startedAtMs = Date.now();

    let wroteOutputNewline = false;
    let responseText = "";

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

      if (completedResponse?.usage && chatModel) {
        process.stdout.write("\n");
        wroteOutputNewline = true;
        const costInfo = calculateCost(chatModel, completedResponse.usage.input_tokens, completedResponse.usage.output_tokens);
        console.error(formatCost(costInfo));
      }
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

      if (response.usage && chatModel) {
        if (!wroteOutputNewline) {
          process.stdout.write("\n");
          wroteOutputNewline = true;
        }
        const costInfo = calculateCost(chatModel, response.usage.input_tokens, response.usage.output_tokens);
        console.error(formatCost(costInfo));
      }
    }

    if (responseText) {
      addMessage(sessionId, "assistant", responseText);

      // Извлечение фактов (стратегия facts)
      if (strategyName === "facts") {
        try {
          const factsModel = getModelForRole("facts");
          const factsModelId = factsModel?.id ?? "openai/gpt-5-nano";
          const currentFacts = getFacts(sessionId);
          const factsInput = buildFactsExtractionInput(currentFacts, config.prompt, responseText);
          const factsResponse = await client.responses.create({
            model: factsModelId,
            instructions: FACTS_EXTRACTION_PROMPT,
            input: factsInput,
            stream: false,
          });
          const factsText = factsResponse.output_text?.trim();
          if (factsText) {
            const newFacts = parseFactsResponse(factsText);
            upsertFacts(sessionId, newFacts);
          }
        } catch {
          // не блокируем основной поток
        }
      }

      // Автоименование
      const session = getSession(sessionId);
      if (session && !session.title && getMessageCount(sessionId) === 2) {
        try {
          const titleModelObj = getModelForRole("title");
          const titleModelId = titleModelObj?.id ?? "openai/gpt-5-nano";
          const titleResponse = await client.responses.create({
            model: titleModelId,
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

    console.error("LLM request failed");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
