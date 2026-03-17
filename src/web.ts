import type { Response as OpenAIResponse } from "openai/resources/responses/responses";

import {
  REASONING_EFFORTS,
  REASONING_SUMMARIES,
  loadConfigInputDefaults,
  resolveConfig,
  type ConfigInputValues,
  type AppConfig,
} from "./config";
import { loadDotEnv } from "./env";
import {
  getHttpStatus,
  isTimeoutError,
  runResponseRequest,
} from "./request-runner";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

await loadDotEnv();
const defaults = loadConfigInputDefaults();
const serverPort = Number(process.env.PORT ?? "3000");

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toTextValue(value: string | undefined): string {
  return value ?? "";
}

function renderSelectOptions(
  currentValue: string | undefined,
  options: readonly string[],
  placeholder: string,
  includeEmpty = true,
): string {
  const items: string[] = [];

  if (includeEmpty) {
    items.push(`<option value="">${escapeHtml(placeholder)}</option>`);
  }

  for (const option of options) {
    const selected = currentValue === option ? ' selected="selected"' : "";
    items.push(
      `<option value="${escapeHtml(option)}"${selected}>${escapeHtml(option)}</option>`,
    );
  }

  return items.join("");
}

function renderMessage(message: ChatMessage, debugHtml = ""): string {
  const roleLabel = message.role === "user" ? "You" : "Assistant";
  const messageClass =
    message.role === "user" ? "message-user" : "message-assistant";

  return `<article class="message ${messageClass}">
    <header>${roleLabel}</header>
    <pre>${escapeHtml(message.content)}</pre>
    ${debugHtml}
  </article>`;
}

function formatOptional(
  value: string | number | boolean | undefined | null,
): string {
  return value === undefined || value === null ? "(not set)" : String(value);
}

function formatUnixSeconds(timestamp: number | undefined | null): string {
  if (timestamp === undefined || timestamp === null) {
    return "(not set)";
  }

  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) {
    return `${timestamp} (invalid)`;
  }

  return `${timestamp} (${date.toISOString()})`;
}

function formatMs(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "(not set)";
  }

  return `${value}ms`;
}

function extractReasoningSummaries(response: OpenAIResponse): string[] {
  const summaries: string[] = [];

  for (const item of response.output) {
    if (item.type !== "reasoning") {
      continue;
    }

    for (const part of item.summary) {
      const text = part.text?.trim();
      if (text) {
        summaries.push(text);
      }
    }
  }

  return summaries;
}

function renderDebugInfo(
  config: AppConfig,
  response: OpenAIResponse | undefined,
  startedAtMs: number,
  reasoningSummaries: string[],
): string {
  if (!response) {
    return "";
  }

  const lines: string[] = [];

  lines.push("Request Debug");
  lines.push(`Requesting: ${config.baseUrl}/responses`);
  lines.push(`Model: ${config.model}`);
  lines.push(`Timeout: ${config.effectiveTimeoutMs}ms`);
  lines.push(`Stream: ${config.useStreaming ? "enabled" : "disabled"}`);
  lines.push(`Reasoning effort: ${formatOptional(config.reasoningEffort)}`);
  lines.push(
    `Reasoning summary mode: ${formatOptional(config.reasoningSummary)}`,
  );
  lines.push(`Temperature: ${formatOptional(config.temperature)}`);
  lines.push(`Top-p: ${formatOptional(config.topP)}`);
  lines.push(`N: ${formatOptional(config.n)}`);
  lines.push(
    `Max completion tokens: ${formatOptional(config.maxCompletionTokens)}`,
  );
  lines.push(`Presence penalty: ${formatOptional(config.presencePenalty)}`);
  lines.push(`Frequency penalty: ${formatOptional(config.frequencyPenalty)}`);

  if (config.n !== undefined) {
    lines.push(
      "Note: OPENAI_N is not supported by Responses API and will be ignored",
    );
  }

  if (config.presencePenalty !== undefined) {
    lines.push(
      "Note: OPENAI_PRESENCE_PENALTY is not supported by Responses API and will be ignored",
    );
  }

  if (config.frequencyPenalty !== undefined) {
    lines.push(
      "Note: OPENAI_FREQUENCY_PENALTY is not supported by Responses API and will be ignored",
    );
  }

  lines.push("");
  lines.push("[Prompts]");
  lines.push("---- System prompt ----");
  lines.push(config.systemPrompt);
  lines.push("");
  lines.push("---- User prompt ----");
  lines.push(config.prompt);
  lines.push("");
  lines.push("Response Debug");
  lines.push(`Response ID: ${response.id}`);
  lines.push(`Response status: ${formatOptional(response.status)}`);
  lines.push(`Service tier: ${formatOptional(response.service_tier)}`);
  lines.push(`Created at: ${formatUnixSeconds(response.created_at)}`);
  lines.push(`Completed at: ${formatUnixSeconds(response.completed_at)}`);

  const queueToCompletionMs =
    response.created_at !== null &&
    response.created_at !== undefined &&
    response.completed_at !== null &&
    response.completed_at !== undefined
      ? Math.max(0, response.completed_at * 1000 - response.created_at * 1000)
      : undefined;
  lines.push(`Model queue->complete: ${formatMs(queueToCompletionMs)}`);
  lines.push(`Client wall time: ${formatMs(Date.now() - startedAtMs)}`);

  const usage = response.usage;
  lines.push("");
  lines.push("[Token usage]");
  if (usage) {
    lines.push(`Input tokens: ${usage.input_tokens}`);
    lines.push(`Output tokens: ${usage.output_tokens}`);
    lines.push(`Total tokens: ${usage.total_tokens}`);
    lines.push(
      `Cached input tokens: ${usage.input_tokens_details.cached_tokens}`,
    );
    lines.push(
      `Reasoning tokens: ${usage.output_tokens_details.reasoning_tokens}`,
    );

    const wallTimeMs = Date.now() - startedAtMs;
    if (wallTimeMs > 0) {
      const outputTps = usage.output_tokens / (wallTimeMs / 1000);
      lines.push(`Output throughput: ${outputTps.toFixed(2)} tok/s`);
    }
  } else {
    lines.push("Availability: (not returned by provider)");
  }

  const extractedSummaries = extractReasoningSummaries(response);
  const effectiveSummaries =
    extractedSummaries.length > 0 ? extractedSummaries : reasoningSummaries;
  lines.push("");
  lines.push("[Reasoning summary]");
  if (effectiveSummaries.length > 0) {
    for (const summary of effectiveSummaries) {
      lines.push(`- ${summary}`);
    }
  } else {
    lines.push("Availability: (not returned)");
  }

  if (response.incomplete_details?.reason) {
    lines.push(`Incomplete reason: ${response.incomplete_details.reason}`);
  }

  if (response.error) {
    lines.push(`Response error: ${response.error.message}`);
  }

  return `<details class="debug-box">
    <summary>Debug</summary>
    <pre>${escapeHtml(lines.join("\n"))}</pre>
  </details>`;
}

function renderChatLog(history: ChatMessage[]): string {
  if (history.length === 0) {
    return `<section id="chat-empty" class="empty-state">
      <h2>Chat is empty</h2>
      <p>Fill in the settings, write a prompt, and the server will call the same Responses API path as the CLI.</p>
    </section>`;
  }

  return `<section id="chat-empty"></section>`;
}

function buildConversationPrompt(
  history: ChatMessage[],
  prompt: string,
): string {
  const transcript = [...history, { role: "user" as const, content: prompt }]
    .map(
      (message) =>
        `${message.role === "user" ? "User" : "Assistant"}:\n${message.content}`,
    )
    .join("\n\n");

  return `Continue the conversation below and answer the final user message.\n\n${transcript}`;
}

function parseHistory(rawValue: string | undefined): ChatMessage[] {
  if (!rawValue?.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((item) => {
      if (
        typeof item !== "object" ||
        item === null ||
        !("role" in item) ||
        !("content" in item) ||
        (item.role !== "user" && item.role !== "assistant") ||
        typeof item.content !== "string"
      ) {
        return [];
      }

      return [{ role: item.role, content: item.content }];
    });
  } catch {
    return [];
  }
}

function formValue(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

function renderPage(history: ChatMessage[], values: ConfigInputValues): string {
  const historyJson = JSON.stringify(history);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>HTMX LLM Chat</title>
    <script src="https://unpkg.com/htmx.org@2.0.4"></script>
    <style>
      :root {
        --bg: #f5efe3;
        --surface: rgba(255, 251, 245, 0.88);
        --surface-strong: #fff9f0;
        --ink: #1d1d1b;
        --muted: #65594d;
        --accent: #0e6b62;
        --accent-2: #b65c3a;
        --line: rgba(29, 29, 27, 0.12);
        --shadow: 0 24px 80px rgba(70, 44, 24, 0.12);
      }

      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: "Georgia", "Times New Roman", serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, rgba(182, 92, 58, 0.18), transparent 32%),
          radial-gradient(circle at top right, rgba(14, 107, 98, 0.22), transparent 28%),
          linear-gradient(180deg, #f9f2e7 0%, #f1e6d6 100%);
      }

      .shell {
        width: min(1400px, calc(100vw - 32px));
        margin: 24px auto;
        display: grid;
        grid-template-columns: 360px 1fr;
        gap: 20px;
      }

      .panel, .chat-panel {
        background: var(--surface);
        backdrop-filter: blur(10px);
        border: 1px solid var(--line);
        border-radius: 24px;
        box-shadow: var(--shadow);
      }

      .panel {
        padding: 20px;
        align-self: start;
        position: sticky;
        top: 24px;
      }

      .chat-panel {
        display: grid;
        grid-template-rows: auto 1fr auto;
        min-height: calc(100vh - 48px);
        overflow: hidden;
      }

      .hero {
        padding: 24px 28px 16px;
        border-bottom: 1px solid var(--line);
      }

      .hero h1, .panel h2 {
        margin: 0;
        font-size: 1.5rem;
        line-height: 1.1;
      }

      .hero p, .field-hint, .meta-note, .empty-state p {
        color: var(--muted);
      }

      .hero p {
        margin: 10px 0 0;
        max-width: 60ch;
      }

      .settings {
        display: grid;
        gap: 14px;
      }

      .field {
        display: grid;
        gap: 6px;
      }

      .grid-2 {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }

      label {
        font-size: 0.9rem;
        font-weight: 700;
        letter-spacing: 0.02em;
      }

      input, select, textarea, button {
        width: 100%;
        border-radius: 14px;
        border: 1px solid rgba(29, 29, 27, 0.15);
        padding: 12px 14px;
        font: inherit;
        color: var(--ink);
        background: rgba(255, 255, 255, 0.72);
      }

      textarea {
        resize: vertical;
        min-height: 110px;
      }

      .messages {
        padding: 24px 28px;
        overflow: auto;
        display: grid;
        gap: 16px;
        align-content: start;
      }

      .message {
        max-width: min(80ch, 92%);
        border-radius: 22px;
        padding: 16px 18px;
        border: 1px solid var(--line);
        background: var(--surface-strong);
      }

      .message-user {
        margin-left: auto;
        background: linear-gradient(135deg, rgba(14, 107, 98, 0.18), rgba(14, 107, 98, 0.08));
      }

      .message-assistant {
        background: linear-gradient(135deg, rgba(182, 92, 58, 0.14), rgba(255, 249, 240, 0.95));
      }

      .message-error {
        border-color: rgba(182, 32, 32, 0.3);
        background: rgba(182, 32, 32, 0.08);
      }

      .message header {
        font-size: 0.78rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
        margin-bottom: 10px;
      }

      .message pre, .debug-box pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        font-family: "Georgia", "Times New Roman", serif;
        line-height: 1.6;
      }

      .composer {
        padding: 18px 24px 24px;
        border-top: 1px solid var(--line);
        background: linear-gradient(180deg, rgba(255, 251, 245, 0.3), rgba(255, 251, 245, 0.88));
      }

      .composer-row {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 12px;
        align-items: end;
      }

      button {
        width: auto;
        min-width: 150px;
        cursor: pointer;
        border: none;
        color: #fff;
        font-weight: 700;
        background: linear-gradient(135deg, var(--accent), var(--accent-2));
      }

      button:disabled {
        opacity: 0.6;
        cursor: wait;
      }

      .status {
        min-height: 24px;
        padding-top: 8px;
        font-size: 0.92rem;
        color: var(--muted);
      }

      .spinner {
        display: none;
      }

      .htmx-request .spinner,
      .htmx-request.spinner {
        display: inline;
      }

      .debug-box {
        margin-top: 12px;
      }

      .debug-box summary {
        cursor: pointer;
        color: var(--muted);
      }

      .empty-state {
        min-height: 100%;
        display: grid;
        place-items: center;
        text-align: center;
        padding: 48px 24px;
      }

      @media (max-width: 980px) {
        .shell {
          width: min(100vw - 24px, 1400px);
          margin: 12px auto;
          grid-template-columns: 1fr;
        }

        .panel {
          position: static;
        }

        .chat-panel {
          min-height: 70vh;
        }

        .grid-2,
        .composer-row {
          grid-template-columns: 1fr;
        }

        button {
          width: 100%;
        }
      }
    </style>
  </head>
  <body>
    <form
      class="shell"
      hx-post="/chat"
      hx-target="#chat-items"
      hx-swap="beforeend"
      hx-indicator="#request-spinner"
      hx-disabled-elt="#send-button"
    >
      <aside class="panel">
        <h2>Settings</h2>
        <p class="meta-note">All request parameters come from the current form, so the web UI can mirror the CLI without separate env edits.</p>
        <div class="settings">
          <div class="field">
            <label for="model">Model</label>
            <select id="model" name="model">
              ${renderSelectOptions(values.model, ["openai/gpt-5-nano"], "Select", false)}
            </select>
          </div>
          <div class="grid-2">
            <div class="field">
              <label for="timeout-ms">Timeout ms</label>
              <input id="timeout-ms" name="timeoutMs" inputmode="numeric" value="${escapeHtml(toTextValue(values.timeoutMs))}" />
            </div>
            <div class="field">
              <label for="use-streaming">Streaming mode</label>
              <select id="use-streaming" name="useStreaming">
                ${renderSelectOptions(values.useStreaming, ["true", "false"], "Select")}
              </select>
            </div>
          </div>
          <div class="grid-2">
            <div class="field">
              <label for="debug">Debug</label>
              <select id="debug" name="debug">
                ${renderSelectOptions(values.debug, ["true", "false"], "Select")}
              </select>
            </div>
            <div class="field">
              <label for="reasoning-effort">Reasoning effort</label>
              <select id="reasoning-effort" name="reasoningEffort">
                ${renderSelectOptions(values.reasoningEffort, REASONING_EFFORTS, "Not set")}
              </select>
            </div>
          </div>
          <div class="field">
            <label for="reasoning-summary">Reasoning summary</label>
            <select id="reasoning-summary" name="reasoningSummary">
              ${renderSelectOptions(values.reasoningSummary, REASONING_SUMMARIES, "Not set")}
            </select>
          </div>
          <div class="grid-2">
            <div class="field">
              <label for="temperature">Temperature</label>
              <input id="temperature" name="temperature" value="${escapeHtml(toTextValue(values.temperature))}" />
            </div>
            <div class="field">
              <label for="top-p">Top P</label>
              <input id="top-p" name="topP" value="${escapeHtml(toTextValue(values.topP))}" />
            </div>
          </div>
          <div class="grid-2">
            <div class="field">
              <label for="n">N</label>
              <input id="n" name="n" value="${escapeHtml(toTextValue(values.n))}" />
              <div class="field-hint">Ignored by Responses API, kept for parity with CLI.</div>
            </div>
            <div class="field">
              <label for="max-completion-tokens">Max completion tokens</label>
              <input id="max-completion-tokens" name="maxCompletionTokens" value="${escapeHtml(toTextValue(values.maxCompletionTokens))}" />
            </div>
          </div>
          <div class="grid-2">
            <div class="field">
              <label for="presence-penalty">Presence penalty</label>
              <input id="presence-penalty" name="presencePenalty" value="${escapeHtml(toTextValue(values.presencePenalty))}" />
              <div class="field-hint">Ignored by Responses API, like in CLI.</div>
            </div>
            <div class="field">
              <label for="frequency-penalty">Frequency penalty</label>
              <input id="frequency-penalty" name="frequencyPenalty" value="${escapeHtml(toTextValue(values.frequencyPenalty))}" />
              <div class="field-hint">Ignored by Responses API, like in CLI.</div>
            </div>
          </div>
          <div class="field">
            <label for="system-prompt">System prompt</label>
            <textarea id="system-prompt" name="systemPrompt" rows="10">${escapeHtml(toTextValue(values.systemPrompt))}</textarea>
          </div>
        </div>
      </aside>

      <main class="chat-panel">
        <section class="hero">
          <h1>HTMX Chat</h1>
          <p>Each submit hits the server, the server calls the same OpenAI-compatible Responses API path as the CLI, and the result is appended to the chat.</p>
        </section>

        <section id="chat-log" class="messages">
          ${renderChatLog(history)}
          <div id="chat-items">${history.map((message) => renderMessage(message)).join("")}</div>
        </section>

        <section class="composer">
          <input id="history-json" type="hidden" name="historyJson" value="${escapeHtml(historyJson)}" />
          <div class="composer-row">
            <div class="field">
              <label for="prompt-input">Message</label>
              <textarea id="prompt-input" name="prompt" placeholder="Write the next user message here">${escapeHtml(toTextValue(values.prompt))}</textarea>
            </div>
            <button id="send-button" type="submit">Send</button>
          </div>
          <div id="request-status" class="status">
            <span id="request-spinner" class="spinner">Request in progress...</span>
          </div>
        </section>
      </main>
    </form>

    <script>
      document.body.addEventListener("htmx:afterSwap", function (event) {
        if (event.target && event.target.id === "chat-items") {
          var chatLog = document.getElementById("chat-log");
          if (chatLog) {
            chatLog.scrollTop = chatLog.scrollHeight;
          }
          var prompt = document.getElementById("prompt-input");
          if (prompt) prompt.focus();
        }
      });
    </script>
  </body>
</html>`;
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
    },
  });
}

function renderStatusSwap(text: string): string {
  return `<div id="request-status" class="status" hx-swap-oob="true">${escapeHtml(text)}</div>`;
}

function renderPromptReset(promptValue = ""): string {
  return `<textarea id="prompt-input" name="prompt" placeholder="Write the next user message here" hx-swap-oob="true">${escapeHtml(promptValue)}</textarea>`;
}

function renderHistorySwap(history: ChatMessage[]): string {
  return `<input id="history-json" type="hidden" name="historyJson" value="${escapeHtml(JSON.stringify(history))}" hx-swap-oob="true" />`;
}

function renderEmptyStateSwap(): string {
  return `<section id="chat-empty" hx-swap-oob="true"></section>`;
}

function renderErrorFragment(
  message: string,
  promptValue: string,
  status = 400,
): Response {
  const body = `${renderMessage({ role: "assistant", content: message }, "")}
${renderEmptyStateSwap()}
${renderPromptReset(promptValue)}
${renderStatusSwap("Request failed")}`;
  return htmlResponse(body, status);
}

async function handleChat(request: Request): Promise<Response> {
  const formData = await request.formData();
  const history = parseHistory(formValue(formData, "historyJson"));
  const prompt = formValue(formData, "prompt")?.trim() ?? "";

  if (!prompt) {
    return renderErrorFragment("Message is required.", "");
  }

  const configInput: ConfigInputValues = {
    ...defaults,
    model: formValue(formData, "model") ?? defaults.model,
    baseUrl: defaults.baseUrl,
    systemPrompt: formValue(formData, "systemPrompt") ?? defaults.systemPrompt,
    timeoutMs: formValue(formData, "timeoutMs") ?? defaults.timeoutMs,
    debug: formValue(formData, "debug") ?? defaults.debug,
    useStreaming: formValue(formData, "useStreaming") ?? defaults.useStreaming,
    reasoningEffort:
      formValue(formData, "reasoningEffort") ?? defaults.reasoningEffort,
    reasoningSummary:
      formValue(formData, "reasoningSummary") ?? defaults.reasoningSummary,
    temperature: formValue(formData, "temperature") ?? defaults.temperature,
    topP: formValue(formData, "topP") ?? defaults.topP,
    n: formValue(formData, "n") ?? defaults.n,
    maxCompletionTokens:
      formValue(formData, "maxCompletionTokens") ??
      defaults.maxCompletionTokens,
    presencePenalty:
      formValue(formData, "presencePenalty") ?? defaults.presencePenalty,
    frequencyPenalty:
      formValue(formData, "frequencyPenalty") ?? defaults.frequencyPenalty,
    prompt: buildConversationPrompt(history, prompt),
  };

  let config;
  try {
    config = resolveConfig(configInput, (message) => {
      throw new Error(message);
    });
  } catch (error) {
    return renderErrorFragment(
      error instanceof Error ? error.message : String(error),
      prompt,
    );
  }

  try {
    const result = await runResponseRequest(config);
    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: result.outputText,
    };
    const userMessage: ChatMessage = { role: "user", content: prompt };
    const updatedHistory = [...history, userMessage, assistantMessage];
    const debugHtml = config.debug
      ? renderDebugInfo(
          config,
          result.response,
          result.startedAtMs,
          result.reasoningSummaryParts,
        )
      : "";
    const fragment = `${renderMessage(userMessage)}
${renderMessage(assistantMessage, debugHtml)}
${renderEmptyStateSwap()}
${renderHistorySwap(updatedHistory)}
${renderPromptReset("")}
${renderStatusSwap("Ready")}`;

    return htmlResponse(fragment);
  } catch (error) {
    if (isTimeoutError(error)) {
      return renderErrorFragment(
        `Request timed out after ${config.effectiveTimeoutMs}ms. Check base URL and connectivity.`,
        prompt,
        504,
      );
    }

    if (getHttpStatus(error) === 429) {
      return renderErrorFragment(
        "Rate limit reached (HTTP 429). Switch provider/model or retry later.",
        prompt,
        429,
      );
    }

    return renderErrorFragment(
      error instanceof Error ? error.message : String(error),
      prompt,
      500,
    );
  }
}

const server = Bun.serve({
  port: Number.isFinite(serverPort) ? serverPort : 3000,
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return htmlResponse(renderPage([], { ...defaults, prompt: "" }));
    }

    if (request.method === "POST" && url.pathname === "/chat") {
      return handleChat(request);
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`HTMX chat server listening on http://localhost:${server.port}`);
