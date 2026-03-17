import { Hono } from "hono";
import type { Response as OpenAIResponse } from "openai/resources/responses/responses";

import {
  REASONING_EFFORTS,
  REASONING_SUMMARIES,
  loadConfigInputDefaults,
  resolveConfig,
  type AppConfig,
  type ConfigInputValues,
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

type StreamPayload =
  | { type: "delta"; text: string }
  | {
      type: "done";
      assistantMessage: string;
      history: ChatMessage[];
      debugHtml: string;
    }
  | {
      type: "error";
      message: string;
      status: number;
    };

await loadDotEnv();

const defaults = loadConfigInputDefaults();
const serverPort = Number(process.env.PORT ?? "3000");
const app = new Hono();

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

function renderMessage(message: ChatMessage): string {
  const isUser = message.role === "user";
  const roleLabel = isUser ? "You" : "Assistant";
  const wrapperClasses = isUser
    ? "ml-auto theme-user-bubble"
    : "mr-auto theme-assistant-bubble";

  return `<article class="max-w-3xl rounded-[28px] border px-5 py-4 shadow-[0_18px_60px_rgba(15,23,42,0.16)] backdrop-blur ${wrapperClasses}">
    <header class="theme-text-muted mb-2 text-[11px] font-semibold uppercase tracking-[0.28em]">${roleLabel}</header>
    <pre class="theme-text whitespace-pre-wrap break-words font-['IBM_Plex_Serif'] text-[15px] leading-7">${escapeHtml(message.content)}</pre>
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
  lines.push(
    `Max completion tokens: ${formatOptional(config.maxCompletionTokens)}`,
  );

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

  return `<details class="theme-debug mt-4 rounded-2xl border">
    <summary class="theme-text-muted cursor-pointer px-4 py-3 text-xs font-semibold uppercase tracking-[0.24em]">Debug</summary>
    <pre class="theme-text overflow-x-auto border-t px-4 py-4 whitespace-pre-wrap break-words text-xs leading-6" style="border-color: var(--line);">${escapeHtml(lines.join("\n"))}</pre>
  </details>`;
}

function renderMessages(history: ChatMessage[]): string {
  if (history.length === 0) {
    return `<section id="empty-state" class="theme-empty grid min-h-full place-items-center rounded-[32px] border border-dashed p-10 text-center">
      <div class="max-w-xl">
        <p class="theme-accent text-xs font-semibold uppercase tracking-[0.34em]">Ready</p>
        <h2 class="theme-title mt-3 font-['Space_Grotesk'] text-3xl font-semibold">Streaming chat поверх Responses API</h2>
        <p class="theme-text-muted mt-4 text-sm leading-7">Слева параметры запроса, справа диалог. При включенном streaming ответ рисуется токенами по мере прихода.</p>
      </div>
    </section>`;
  }

  return history.map((message) => renderMessage(message)).join("");
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

function buildConfigInput(
  formData: FormData,
  history: ChatMessage[],
  prompt: string,
): ConfigInputValues {
  return {
    ...defaults,
    model: formValue(formData, "model") ?? defaults.model,
    baseUrl: formValue(formData, "baseUrl") ?? defaults.baseUrl,
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
    maxCompletionTokens:
      formValue(formData, "maxCompletionTokens") ??
      defaults.maxCompletionTokens,
    prompt: buildConversationPrompt(history, prompt),
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function createStreamResponse(
  build: (send: (payload: StreamPayload) => Promise<void>) => Promise<void>,
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = async (payload: StreamPayload) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };

      try {
        await build(send);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

function renderPage(history: ChatMessage[], values: ConfigInputValues): string {
  return `<!doctype html>
<html lang="en" class="h-full bg-slate-950">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Responses Chat</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
      tailwind.config = {
        theme: {
          extend: {
            fontFamily: {
              sans: ["Space Grotesk", "ui-sans-serif", "system-ui"],
              serif: ["IBM Plex Serif", "ui-serif", "Georgia"]
            },
            colors: {
              ink: "#e5eef8"
            },
            boxShadow: {
              glow: "0 32px 120px rgba(34, 211, 238, 0.16)"
            }
          }
        }
      };
    </script>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Serif:wght@400;500;600&family=Space+Grotesk:wght@400;500;700&display=swap" rel="stylesheet" />
    <style>
      :root {
        --bg:
          radial-gradient(circle at top left, rgba(34, 211, 238, 0.18), transparent 28%),
          radial-gradient(circle at top right, rgba(244, 114, 182, 0.16), transparent 24%),
          linear-gradient(180deg, #020617 0%, #0f172a 45%, #111827 100%);
        --panel: rgba(15, 23, 42, 0.72);
        --panel-strong: rgba(2, 6, 23, 0.42);
        --surface: rgba(255, 255, 255, 0.08);
        --surface-muted: rgba(255, 255, 255, 0.05);
        --surface-strong: rgba(2, 6, 23, 0.72);
        --line: rgba(255, 255, 255, 0.1);
        --line-strong: rgba(255, 255, 255, 0.16);
        --text: #e5eef8;
        --text-soft: #cbd5e1;
        --text-muted: #94a3b8;
        --accent: #67e8f9;
        --accent-soft: rgba(34, 211, 238, 0.12);
        --accent-line: rgba(34, 211, 238, 0.2);
        --accent-strong: #0f172a;
        --accent-2: #f0abfc;
        --user-bubble: rgba(16, 185, 129, 0.12);
        --user-line: rgba(16, 185, 129, 0.3);
        --assistant-bubble: rgba(255, 255, 255, 0.08);
        --assistant-line: rgba(255, 255, 255, 0.12);
        --input-bg: rgba(2, 6, 23, 0.72);
        --button-bg: linear-gradient(90deg, #22d3ee 0%, #38bdf8 50%, #e879f9 100%);
        --shadow: 0 32px 120px rgba(34, 211, 238, 0.16);
      }

      body[data-theme="cappuccino"] {
        --bg:
          radial-gradient(circle at top left, rgba(214, 152, 111, 0.28), transparent 28%),
          radial-gradient(circle at top right, rgba(120, 77, 60, 0.18), transparent 22%),
          linear-gradient(180deg, #f8efe4 0%, #eadbc8 48%, #d9c0aa 100%);
        --panel: rgba(255, 248, 240, 0.72);
        --panel-strong: rgba(255, 251, 246, 0.42);
        --surface: rgba(255, 255, 255, 0.48);
        --surface-muted: rgba(255, 255, 255, 0.28);
        --surface-strong: rgba(255, 250, 244, 0.88);
        --line: rgba(115, 77, 57, 0.14);
        --line-strong: rgba(115, 77, 57, 0.22);
        --text: #3f2b22;
        --text-soft: #5c4337;
        --text-muted: #7a5f53;
        --accent: #9a5a37;
        --accent-soft: rgba(154, 90, 55, 0.1);
        --accent-line: rgba(154, 90, 55, 0.18);
        --accent-strong: #fffaf4;
        --accent-2: #6f8f6b;
        --user-bubble: rgba(111, 143, 107, 0.16);
        --user-line: rgba(111, 143, 107, 0.32);
        --assistant-bubble: rgba(255, 255, 255, 0.55);
        --assistant-line: rgba(115, 77, 57, 0.12);
        --input-bg: rgba(255, 252, 248, 0.84);
        --button-bg: linear-gradient(90deg, #9a5a37 0%, #c4845a 50%, #6f8f6b 100%);
        --shadow: 0 30px 90px rgba(115, 77, 57, 0.16);
      }

      body[data-theme="darkula"] {
        --bg:
          radial-gradient(circle at top left, rgba(189, 147, 249, 0.16), transparent 28%),
          radial-gradient(circle at top right, rgba(255, 121, 198, 0.12), transparent 22%),
          linear-gradient(180deg, #282a36 0%, #1f2230 54%, #191a21 100%);
        --panel: rgba(40, 42, 54, 0.8);
        --panel-strong: rgba(24, 25, 33, 0.46);
        --surface: rgba(68, 71, 90, 0.4);
        --surface-muted: rgba(68, 71, 90, 0.24);
        --surface-strong: rgba(30, 31, 41, 0.78);
        --line: rgba(248, 248, 242, 0.1);
        --line-strong: rgba(248, 248, 242, 0.16);
        --text: #f8f8f2;
        --text-soft: #e2def1;
        --text-muted: #b8b5c9;
        --accent: #8be9fd;
        --accent-soft: rgba(139, 233, 253, 0.12);
        --accent-line: rgba(139, 233, 253, 0.2);
        --accent-strong: #282a36;
        --accent-2: #ff79c6;
        --user-bubble: rgba(80, 250, 123, 0.12);
        --user-line: rgba(80, 250, 123, 0.24);
        --assistant-bubble: rgba(68, 71, 90, 0.4);
        --assistant-line: rgba(248, 248, 242, 0.1);
        --input-bg: rgba(24, 25, 33, 0.78);
        --button-bg: linear-gradient(90deg, #8be9fd 0%, #bd93f9 50%, #ff79c6 100%);
        --shadow: 0 32px 120px rgba(189, 147, 249, 0.18);
      }

      body[data-theme="light"] {
        --bg:
          radial-gradient(circle at top left, rgba(59, 130, 246, 0.16), transparent 28%),
          radial-gradient(circle at top right, rgba(16, 185, 129, 0.12), transparent 24%),
          linear-gradient(180deg, #f8fafc 0%, #eef2ff 45%, #e2e8f0 100%);
        --panel: rgba(255, 255, 255, 0.72);
        --panel-strong: rgba(255, 255, 255, 0.44);
        --surface: rgba(255, 255, 255, 0.62);
        --surface-muted: rgba(255, 255, 255, 0.38);
        --surface-strong: rgba(255, 255, 255, 0.88);
        --line: rgba(15, 23, 42, 0.08);
        --line-strong: rgba(15, 23, 42, 0.14);
        --text: #0f172a;
        --text-soft: #334155;
        --text-muted: #64748b;
        --accent: #2563eb;
        --accent-soft: rgba(37, 99, 235, 0.1);
        --accent-line: rgba(37, 99, 235, 0.16);
        --accent-strong: #eff6ff;
        --accent-2: #0f766e;
        --user-bubble: rgba(16, 185, 129, 0.12);
        --user-line: rgba(16, 185, 129, 0.22);
        --assistant-bubble: rgba(255, 255, 255, 0.72);
        --assistant-line: rgba(15, 23, 42, 0.08);
        --input-bg: rgba(255, 255, 255, 0.86);
        --button-bg: linear-gradient(90deg, #2563eb 0%, #38bdf8 50%, #0f766e 100%);
        --shadow: 0 30px 110px rgba(37, 99, 235, 0.12);
      }

      body[data-theme="forest"] {
        --bg:
          radial-gradient(circle at top left, rgba(74, 222, 128, 0.16), transparent 28%),
          radial-gradient(circle at top right, rgba(251, 191, 36, 0.12), transparent 22%),
          linear-gradient(180deg, #0b1f19 0%, #102a22 46%, #1f3b2e 100%);
        --panel: rgba(9, 30, 23, 0.76);
        --panel-strong: rgba(7, 21, 17, 0.44);
        --surface: rgba(255, 255, 255, 0.08);
        --surface-muted: rgba(255, 255, 255, 0.04);
        --surface-strong: rgba(8, 24, 18, 0.8);
        --line: rgba(187, 247, 208, 0.12);
        --line-strong: rgba(187, 247, 208, 0.18);
        --text: #ecfdf5;
        --text-soft: #d1fae5;
        --text-muted: #a7c9b9;
        --accent: #4ade80;
        --accent-soft: rgba(74, 222, 128, 0.12);
        --accent-line: rgba(74, 222, 128, 0.2);
        --accent-strong: #052e16;
        --accent-2: #fbbf24;
        --user-bubble: rgba(251, 191, 36, 0.12);
        --user-line: rgba(251, 191, 36, 0.24);
        --assistant-bubble: rgba(255, 255, 255, 0.06);
        --assistant-line: rgba(187, 247, 208, 0.12);
        --input-bg: rgba(7, 21, 17, 0.82);
        --button-bg: linear-gradient(90deg, #4ade80 0%, #22c55e 50%, #fbbf24 100%);
        --shadow: 0 30px 110px rgba(74, 222, 128, 0.12);
      }

      body {
        background: var(--bg);
        color: var(--text);
      }

      .theme-panel {
        background: var(--panel);
        border-color: var(--line);
        box-shadow: var(--shadow);
      }

      .theme-panel-strong {
        background: var(--panel-strong);
        border-color: var(--line);
        box-shadow: var(--shadow);
      }

      .theme-surface {
        background: var(--surface);
        border-color: var(--line);
      }

      .theme-surface-muted {
        background: var(--surface-muted);
        border-color: var(--line);
      }

      .theme-input {
        background: var(--input-bg);
        border-color: var(--line);
        color: var(--text);
      }

      .theme-input::placeholder {
        color: var(--text-muted);
      }

      .theme-input:focus {
        border-color: var(--accent);
        box-shadow: 0 0 0 2px var(--accent-soft);
      }

      .theme-title,
      .theme-text {
        color: var(--text);
      }

      .theme-text-soft {
        color: var(--text-soft);
      }

      .theme-text-muted {
        color: var(--text-muted);
      }

      .theme-accent {
        color: var(--accent);
      }

      .theme-accent-2 {
        color: var(--accent-2);
      }

      .theme-chip {
        border-color: var(--accent-line);
        background: var(--accent-soft);
        color: var(--text);
      }

      .theme-button {
        background: var(--button-bg);
        color: var(--accent-strong);
      }

      .theme-user-bubble {
        background: var(--user-bubble);
        border-color: var(--user-line);
      }

      .theme-assistant-bubble {
        background: var(--assistant-bubble);
        border-color: var(--assistant-line);
      }

      .theme-debug {
        background: var(--surface-strong);
        border-color: var(--line-strong);
      }

      .theme-empty {
        background: var(--surface-muted);
        border-color: var(--line);
      }
    </style>
  </head>
  <body data-theme="dark" class="min-h-full">
    <div class="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col gap-6 px-4 py-4 md:px-6 lg:flex-row lg:px-8">
      <aside class="theme-panel w-full shrink-0 rounded-[32px] border p-5 backdrop-blur xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)] xl:w-[390px] xl:overflow-auto">
        <div class="mb-5 flex justify-end">
          <div class="w-[150px] space-y-2">
            <label for="theme-select" class="theme-text-muted text-[11px] font-semibold uppercase tracking-[0.24em]">Theme</label>
            <select id="theme-select" class="theme-input w-full rounded-2xl border px-4 py-3 text-sm outline-none transition">
              <option value="dark">Dark</option>
              <option value="darkula">Darkula</option>
              <option value="cappuccino">Cappuccino</option>
              <option value="light">Light</option>
              <option value="forest">Forest</option>
            </select>
          </div>
        </div>

        <form id="chat-form" class="space-y-5">
          <input id="history-json" type="hidden" name="historyJson" value="${escapeHtml(JSON.stringify(history))}" />

          <div class="space-y-2">
            <label for="system-prompt" class="theme-text-muted text-xs font-semibold uppercase tracking-[0.22em]">System prompt</label>
            <textarea id="system-prompt" name="systemPrompt" rows="10" class="theme-input w-full rounded-[24px] border px-4 py-3 text-sm leading-7 outline-none transition">${escapeHtml(toTextValue(values.systemPrompt))}</textarea>
          </div>

          <div class="space-y-2">
            <label for="model" class="theme-text-muted text-xs font-semibold uppercase tracking-[0.22em]">Model</label>
            <input id="model" name="model" value="${escapeHtml(toTextValue(values.model))}" class="theme-input w-full rounded-2xl border px-4 py-3 text-sm outline-none transition" />
          </div>

          <div class="space-y-2">
            <label for="base-url" class="theme-text-muted text-xs font-semibold uppercase tracking-[0.22em]">Base URL</label>
            <input id="base-url" name="baseUrl" value="${escapeHtml(toTextValue(values.baseUrl))}" class="theme-input w-full rounded-2xl border px-4 py-3 text-sm outline-none transition" />
          </div>

          <div class="grid gap-4 md:grid-cols-2">
            <div class="space-y-2">
              <label for="timeout-ms" class="theme-text-muted text-xs font-semibold uppercase tracking-[0.22em]">Timeout ms</label>
              <input id="timeout-ms" name="timeoutMs" inputmode="numeric" value="${escapeHtml(toTextValue(values.timeoutMs))}" class="theme-input w-full rounded-2xl border px-4 py-3 text-sm outline-none transition" />
            </div>
            <div class="space-y-2">
              <label for="use-streaming" class="theme-text-muted text-xs font-semibold uppercase tracking-[0.22em]">Streaming</label>
              <select id="use-streaming" name="useStreaming" class="theme-input w-full rounded-2xl border px-4 py-3 text-sm outline-none transition">
                ${renderSelectOptions(values.useStreaming, ["true", "false"], "Select")}
              </select>
            </div>
          </div>

          <div class="grid gap-4 md:grid-cols-2">
            <div class="space-y-2">
              <label for="debug" class="theme-text-muted text-xs font-semibold uppercase tracking-[0.22em]">Debug</label>
              <select id="debug" name="debug" class="theme-input w-full rounded-2xl border px-4 py-3 text-sm outline-none transition">
                ${renderSelectOptions(values.debug, ["true", "false"], "Select")}
              </select>
            </div>
            <div class="space-y-2">
              <label for="reasoning-effort" class="theme-text-muted text-xs font-semibold uppercase tracking-[0.22em]">Reasoning effort</label>
              <select id="reasoning-effort" name="reasoningEffort" class="theme-input w-full rounded-2xl border px-4 py-3 text-sm outline-none transition">
                ${renderSelectOptions(values.reasoningEffort, REASONING_EFFORTS, "Not set")}
              </select>
            </div>
          </div>

          <div class="space-y-2">
            <label for="reasoning-summary" class="theme-text-muted text-xs font-semibold uppercase tracking-[0.22em]">Reasoning summary</label>
            <select id="reasoning-summary" name="reasoningSummary" class="theme-input w-full rounded-2xl border px-4 py-3 text-sm outline-none transition">
              ${renderSelectOptions(values.reasoningSummary, REASONING_SUMMARIES, "Not set")}
            </select>
          </div>

          <div class="grid gap-4 md:grid-cols-2">
            <div class="space-y-2">
              <label for="temperature" class="theme-text-muted text-xs font-semibold uppercase tracking-[0.22em]">Temperature</label>
              <input id="temperature" name="temperature" value="${escapeHtml(toTextValue(values.temperature))}" class="theme-input w-full rounded-2xl border px-4 py-3 text-sm outline-none transition" />
            </div>
            <div class="space-y-2">
              <label for="top-p" class="theme-text-muted text-xs font-semibold uppercase tracking-[0.22em]">Top P</label>
              <input id="top-p" name="topP" value="${escapeHtml(toTextValue(values.topP))}" class="theme-input w-full rounded-2xl border px-4 py-3 text-sm outline-none transition" />
            </div>
          </div>

          <div class="space-y-2">
            <label for="max-completion-tokens" class="theme-text-muted text-xs font-semibold uppercase tracking-[0.22em]">Max completion tokens</label>
            <input id="max-completion-tokens" name="maxCompletionTokens" value="${escapeHtml(toTextValue(values.maxCompletionTokens))}" class="theme-input w-full rounded-2xl border px-4 py-3 text-sm outline-none transition" />
            <p class="theme-text-muted text-xs leading-5">Ограничение на число output tokens для Responses API.</p>
          </div>
        </form>
      </aside>

      <main class="theme-panel-strong flex min-h-[78vh] flex-1 flex-col overflow-hidden rounded-[36px] border backdrop-blur">
        <section class="border-b px-6 py-6 md:px-8" style="border-color: var(--line);">
          <div class="flex justify-end">
            <div id="request-status" class="theme-chip rounded-full border px-4 py-2 text-sm">Ready</div>
          </div>
        </section>

        <section id="chat-log" class="flex-1 space-y-4 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
          ${renderMessages(history)}
        </section>

        <section class="border-t px-4 py-4 md:px-6 md:py-6" style="border-color: var(--line); background: var(--panel-strong);">
          <div class="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
            <div class="space-y-2">
              <label for="prompt-input" class="theme-text-muted text-xs font-semibold uppercase tracking-[0.22em]">Message</label>
              <textarea id="prompt-input" name="prompt" form="chat-form" rows="4" placeholder="Напиши следующее сообщение" class="theme-input w-full rounded-[28px] border px-5 py-4 text-sm leading-7 outline-none transition">${escapeHtml(toTextValue(values.prompt))}</textarea>
            </div>
            <button id="send-button" type="submit" form="chat-form" class="theme-button inline-flex h-14 items-center justify-center rounded-full px-8 text-sm font-semibold transition hover:scale-[1.01] disabled:cursor-wait disabled:opacity-60">Send message</button>
          </div>
        </section>
      </main>
    </div>

    <script>
      (function () {
        var form = document.getElementById("chat-form");
        var chatLog = document.getElementById("chat-log");
        var promptInput = document.getElementById("prompt-input");
        var historyInput = document.getElementById("history-json");
        var sendButton = document.getElementById("send-button");
        var statusNode = document.getElementById("request-status");
        var themeSelect = document.getElementById("theme-select");
        var requestInFlight = false;
        var availableThemes = ["dark", "darkula", "cappuccino", "light", "forest"];

        function scrollChat() {
          if (chatLog) {
            chatLog.scrollTop = chatLog.scrollHeight;
          }
        }

        function setStatus(text, tone) {
          if (!statusNode) return;
          statusNode.textContent = text;
          statusNode.className =
            "rounded-full border px-4 py-2 text-sm " +
            (tone === "error"
              ? ""
              : tone === "busy"
                ? ""
                : "theme-chip");
          if (tone === "error") {
            statusNode.style.borderColor = "rgba(244, 63, 94, 0.28)";
            statusNode.style.background = "rgba(244, 63, 94, 0.12)";
            statusNode.style.color = "var(--text)";
          } else if (tone === "busy") {
            statusNode.style.borderColor = "rgba(245, 158, 11, 0.28)";
            statusNode.style.background = "rgba(245, 158, 11, 0.12)";
            statusNode.style.color = "var(--text)";
          } else {
            statusNode.style.borderColor = "";
            statusNode.style.background = "";
            statusNode.style.color = "";
          }
        }

        function setBusy(busy) {
          requestInFlight = busy;
          if (sendButton) sendButton.disabled = busy;
        }

        function getHistory() {
          if (!historyInput || !historyInput.value.trim()) return [];
          try {
            var parsed = JSON.parse(historyInput.value);
            return Array.isArray(parsed) ? parsed : [];
          } catch (error) {
            return [];
          }
        }

        function setHistory(history) {
          if (historyInput) {
            historyInput.value = JSON.stringify(history);
          }
        }

        function removeEmptyState() {
          var empty = document.getElementById("empty-state");
          if (empty) empty.remove();
        }

        function createMessage(role, content) {
          removeEmptyState();
          var article = document.createElement("article");
          article.className =
            "max-w-3xl rounded-[28px] border px-5 py-4 shadow-[0_18px_60px_rgba(15,23,42,0.16)] backdrop-blur " +
            (role === "user"
              ? "ml-auto theme-user-bubble"
              : "mr-auto theme-assistant-bubble");

          var header = document.createElement("header");
          header.className =
            "theme-text-muted mb-2 text-[11px] font-semibold uppercase tracking-[0.28em]";
          header.textContent = role === "user" ? "You" : "Assistant";

          var pre = document.createElement("pre");
          pre.className =
            "theme-text whitespace-pre-wrap break-words font-['IBM_Plex_Serif'] text-[15px] leading-7";
          pre.textContent = content || "";

          article.appendChild(header);
          article.appendChild(pre);
          if (chatLog) {
            chatLog.appendChild(article);
          }

          return { article: article, pre: pre };
        }

        function appendDebug(article, debugHtml) {
          if (article && debugHtml) {
            article.insertAdjacentHTML("beforeend", debugHtml);
          }
        }

        function collectFormData() {
          return new FormData(form);
        }

        function applyTheme(theme) {
          var nextTheme = availableThemes.indexOf(theme) === -1 ? "dark" : theme;
          document.body.setAttribute("data-theme", nextTheme);
          if (themeSelect) {
            themeSelect.value = nextTheme;
          }
          try {
            localStorage.setItem("chat-theme", nextTheme);
          } catch (error) {}
        }

        async function runNonStreaming(promptValue) {
          var response = await fetch("/api/chat", {
            method: "POST",
            body: collectFormData()
          });
          var payload = await response.json();
          if (!response.ok) {
            throw new Error(payload.message || "Request failed.");
          }

          var userNode = createMessage("user", promptValue);
          var assistantNode = createMessage("assistant", payload.assistantMessage || "");
          appendDebug(assistantNode.article, payload.debugHtml || "");
          setHistory(payload.history || []);
        }

        async function runStreaming(promptValue) {
          var userNode = createMessage("user", promptValue);
          var assistantNode = createMessage("assistant", "");
          var response = await fetch("/api/chat/stream", {
            method: "POST",
            body: collectFormData()
          });

          if (!response.ok || !response.body) {
            userNode.article.remove();
            assistantNode.article.remove();
            throw new Error("Streaming request failed.");
          }

          var reader = response.body.getReader();
          var decoder = new TextDecoder();
          var buffer = "";

          function applyPayload(payload) {
            if (payload.type === "delta" && payload.text) {
              assistantNode.pre.textContent += payload.text;
              scrollChat();
              return;
            }

            if (payload.type === "done") {
              if (!assistantNode.pre.textContent && payload.assistantMessage) {
                assistantNode.pre.textContent = payload.assistantMessage;
              }
              appendDebug(assistantNode.article, payload.debugHtml || "");
              setHistory(payload.history || []);
              return;
            }

            if (payload.type === "error") {
              userNode.article.remove();
              assistantNode.article.remove();
              throw new Error(payload.message || "Streaming request failed.");
            }
          }

          while (true) {
            var result = await reader.read();
            if (result.done) break;
            buffer += decoder.decode(result.value, { stream: true });
            var lines = buffer.split("\\n");
            buffer = lines.pop() || "";

            for (var i = 0; i < lines.length; i += 1) {
              if (!lines[i].trim()) continue;
              applyPayload(JSON.parse(lines[i]));
            }
          }

          if (buffer.trim()) {
            applyPayload(JSON.parse(buffer));
          }
        }

        if (form) {
          form.addEventListener("submit", async function (event) {
            event.preventDefault();
            if (requestInFlight) return;

            var promptValue = promptInput ? promptInput.value.trim() : "";
            if (!promptValue) {
              setStatus("Message is required", "error");
              return;
            }

            setBusy(true);
            setStatus("Request in progress...", "busy");

            try {
              var streamingMode = form.elements.namedItem("useStreaming");
              var useStreaming = streamingMode && streamingMode.value === "true";
              if (useStreaming) await runStreaming(promptValue);
              else await runNonStreaming(promptValue);

              if (promptInput) promptInput.value = "";
              setStatus("Ready", "ready");
            } catch (error) {
              setStatus(error instanceof Error ? error.message : String(error), "error");
            } finally {
              setBusy(false);
              scrollChat();
              if (promptInput) promptInput.focus();
            }
          });
        }

        if (themeSelect) {
          themeSelect.addEventListener("change", function () {
            applyTheme(themeSelect.value);
          });
        }

        try {
          applyTheme(localStorage.getItem("chat-theme") || "dark");
        } catch (error) {
          applyTheme("dark");
        }

        scrollChat();
        if (promptInput) promptInput.focus();
      })();
    </script>
  </body>
</html>`;
}

async function handleChatForm(formData: FormData): Promise<{
  history: ChatMessage[];
  assistantMessage: string;
  debugHtml: string;
}> {
  const history = parseHistory(formValue(formData, "historyJson"));
  const prompt = formValue(formData, "prompt")?.trim() ?? "";

  if (!prompt) {
    throw new Error("Message is required.");
  }

  const configInput = buildConfigInput(formData, history, prompt);
  const config = resolveConfig(configInput, (message) => {
    throw new Error(message);
  });

  const result = await runResponseRequest(config);
  const assistantMessage = result.outputText;
  const updatedHistory = [
    ...history,
    { role: "user" as const, content: prompt },
    { role: "assistant" as const, content: assistantMessage },
  ];

  return {
    history: updatedHistory,
    assistantMessage,
    debugHtml: config.debug
      ? renderDebugInfo(
          config,
          result.response,
          result.startedAtMs,
          result.reasoningSummaryParts,
        )
      : "",
  };
}

function toErrorResponse(
  error: unknown,
  timeoutMs?: number,
): {
  status: number;
  message: string;
} {
  if (isTimeoutError(error)) {
    return {
      status: 504,
      message: `Request timed out after ${timeoutMs ?? defaults.timeoutMs ?? "the configured timeout"}ms. Check base URL and connectivity.`,
    };
  }

  if (getHttpStatus(error) === 429) {
    return {
      status: 429,
      message:
        "Rate limit reached (HTTP 429). Switch provider/model or retry later.",
    };
  }

  return {
    status: 500,
    message: error instanceof Error ? error.message : String(error),
  };
}

app.get("/", (c) => c.html(renderPage([], { ...defaults, prompt: "" })));

app.post("/api/chat", async (c) => {
  const formData = await c.req.formData();

  try {
    const payload = await handleChatForm(formData);
    return jsonResponse(payload);
  } catch (error) {
    let timeoutMs: number | undefined;

    try {
      const history = parseHistory(formValue(formData, "historyJson"));
      const prompt = formValue(formData, "prompt")?.trim() ?? "";
      const config = resolveConfig(
        buildConfigInput(formData, history, prompt),
        (message) => {
          throw new Error(message);
        },
      );
      timeoutMs = config.effectiveTimeoutMs;
    } catch {
      timeoutMs = undefined;
    }

    const result = toErrorResponse(error, timeoutMs);
    return jsonResponse({ message: result.message }, result.status);
  }
});

app.post("/api/chat/stream", async (c) => {
  const formData = await c.req.formData();
  const history = parseHistory(formValue(formData, "historyJson"));
  const prompt = formValue(formData, "prompt")?.trim() ?? "";

  if (!prompt) {
    return createStreamResponse(async (send) => {
      await send({
        type: "error",
        message: "Message is required.",
        status: 400,
      });
    });
  }

  let config: AppConfig;
  try {
    config = resolveConfig(
      buildConfigInput(formData, history, prompt),
      (message) => {
        throw new Error(message);
      },
    );
  } catch (error) {
    return createStreamResponse(async (send) => {
      await send({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
        status: 400,
      });
    });
  }

  return createStreamResponse(async (send) => {
    try {
      const result = await runResponseRequest(
        { ...config, useStreaming: true },
        {
          onOutputTextDelta: (delta) => {
            if (delta.length > 0) {
              void send({ type: "delta", text: delta });
            }
          },
        },
      );

      const assistantMessage = result.outputText;
      const updatedHistory = [
        ...history,
        { role: "user" as const, content: prompt },
        { role: "assistant" as const, content: assistantMessage },
      ];

      await send({
        type: "done",
        assistantMessage,
        history: updatedHistory,
        debugHtml: config.debug
          ? renderDebugInfo(
              { ...config, useStreaming: true },
              result.response,
              result.startedAtMs,
              result.reasoningSummaryParts,
            )
          : "",
      });
    } catch (error) {
      const result = toErrorResponse(error, config.effectiveTimeoutMs);
      await send({
        type: "error",
        message: result.message,
        status: result.status,
      });
    }
  });
});

app.notFound(() => new Response("Not found", { status: 404 }));

const server = Bun.serve({
  port: Number.isFinite(serverPort) ? serverPort : 3000,
  fetch: app.fetch,
});

console.log(`Web chat server listening on http://localhost:${server.port}`);
