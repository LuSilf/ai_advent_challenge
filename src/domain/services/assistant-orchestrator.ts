import type {
  AssistantChatMessage,
  AssistantLLMClient,
  AssistantToolCall,
  AssistantToolDefinition,
} from "../ports/assistant-llm";
import type { Embedder } from "../ports/embedder";
import type { VectorIndex } from "../ports/vector-index";
import type { VectorSearchHit } from "../models/chunking";

export type Citation = {
  label: number;
  source: string;
  lineStart?: number;
  lineEnd?: number;
};

export type OrchestratorEvent =
  | { kind: "retrieval"; hits: VectorSearchHit[] }
  | { kind: "tool_call"; name: string; args: string }
  | { kind: "tool_result"; name: string; result: string; isError: boolean }
  | { kind: "token"; delta: string }
  | { kind: "final"; citations: Citation[]; text: string }
  | { kind: "error"; message: string };

export type AssistantHistoryEntry =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

export type ToolExecutor = (call: AssistantToolCall) => Promise<{ content: string; isError: boolean }>;

export type AssistantOrchestratorDeps = {
  llmClient: AssistantLLMClient;
  embedder: Embedder;
  vectorIndex: VectorIndex;
  model: string;
  topK: number;
  systemPromptHeader: string;
  toolLoopMax: number;
  tools?: AssistantToolDefinition[];
  toolExecutor?: ToolExecutor;
};

const DEFAULT_INSTRUCTIONS = [
  "Отвечай ТОЛЬКО на основе предоставленного ниже контекста и результатов tools.",
  "Когда ссылаешься на источник — пиши `[N]` (число — номер источника из списка контекста).",
  "Если контекста недостаточно — скажи прямо «не нашёл в документации».",
].join(" ");

export class AssistantOrchestrator {
  constructor(private readonly deps: AssistantOrchestratorDeps) {}

  async *ask(question: string, history: AssistantHistoryEntry[] = []): AsyncIterable<OrchestratorEvent> {
    const { llmClient, embedder, vectorIndex, model, topK, systemPromptHeader, toolLoopMax, tools, toolExecutor } =
      this.deps;

    let hits: VectorSearchHit[];
    try {
      const [queryVector] = await embedder.embed([question]);
      hits = vectorIndex.search(queryVector!, topK);
    } catch (err) {
      yield { kind: "error", message: `retrieval failed: ${err instanceof Error ? err.message : String(err)}` };
      return;
    }
    yield { kind: "retrieval", hits };

    const systemContent = buildSystemPrompt(systemPromptHeader, hits);
    const messages: AssistantChatMessage[] = [{ role: "system", content: systemContent }];
    for (const entry of history) {
      messages.push({ role: entry.role, content: entry.content });
    }
    messages.push({ role: "user", content: question });

    let finalText = "";

    for (let iter = 0; iter < toolLoopMax; iter++) {
      let toolCalls: AssistantToolCall[] = [];
      let finishReason: "stop" | "tool_calls" | "length" | "other" = "other";
      let assistantText = "";

      const stream = llmClient.stream({ model, messages, tools });
      for await (const event of stream) {
        if (event.kind === "delta") {
          assistantText += event.text;
          if (toolCalls.length === 0) {
            yield { kind: "token", delta: event.text };
          }
        } else if (event.kind === "tool_call") {
          toolCalls = event.calls;
        } else if (event.kind === "done") {
          finishReason = event.finishReason;
        }
      }

      if (toolCalls.length > 0 && toolExecutor) {
        messages.push({
          role: "assistant",
          content: assistantText,
          toolCalls,
        });
        for (const call of toolCalls) {
          yield { kind: "tool_call", name: call.name, args: call.arguments };
          const result = await toolExecutor(call);
          yield { kind: "tool_result", name: call.name, result: result.content, isError: result.isError };
          messages.push({ role: "tool", content: result.content, toolCallId: call.id });
        }
        continue;
      }

      finalText = assistantText;
      if (finishReason !== "tool_calls") break;
      // tool_calls finishReason but no executor → break to avoid loop
      break;
    }

    const citations = parseCitations(finalText, hits);
    yield { kind: "final", citations, text: finalText };
  }
}

export function buildSystemPrompt(header: string, hits: VectorSearchHit[]): string {
  const parts: string[] = [header.trim(), DEFAULT_INSTRUCTIONS];
  if (hits.length === 0) {
    parts.push("## Контекст\n\nКонтекст пуст. Отвечай честно: «не нашёл в документации».");
  } else {
    const lines: string[] = ["## Контекст из документации"];
    hits.forEach((h, i) => {
      const label = i + 1;
      const range = formatRange(h.source, h.lineStart, h.lineEnd);
      lines.push(`\n[${label}] ${range}`);
      lines.push(h.text);
    });
    parts.push(lines.join("\n"));
  }
  return parts.join("\n\n");
}

function formatRange(source: string, lineStart?: number, lineEnd?: number): string {
  if (lineStart === undefined || lineEnd === undefined) return source;
  if (lineStart === lineEnd) return `${source}:${lineStart}`;
  return `${source}:${lineStart}-${lineEnd}`;
}

export function parseCitations(text: string, hits: VectorSearchHit[]): Citation[] {
  const seen = new Set<number>();
  const out: Citation[] = [];
  const matches = text.matchAll(/\[(\d+)\]/g);
  for (const m of matches) {
    const label = Number(m[1]);
    if (!Number.isInteger(label) || label < 1 || label > hits.length) continue;
    if (seen.has(label)) continue;
    seen.add(label);
    const hit = hits[label - 1]!;
    out.push({
      label,
      source: hit.source,
      lineStart: hit.lineStart,
      lineEnd: hit.lineEnd,
    });
  }
  return out;
}
