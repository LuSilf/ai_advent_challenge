import type { LLMClient } from "../ports/llm-client";
import type { ModelRepository } from "../ports/model-repository";
import type { TaskStateRepository } from "../ports/task-state-repository";
import { isEmptyTaskState, TaskStatePayloadSchema, taskStatePayloadToOpenAISchema, type TaskState, type TaskStatePayload } from "../models/task-state";
import type { LLMRequest } from "../models";

export type ReconcileResult = {
  state: TaskState;
  changed: boolean;
  inputTokens: number;
  outputTokens: number;
  error?: string;
};

const RECONCILE_INSTRUCTIONS = `Ты — помощник по управлению состоянием задачи в диалоге.
Задача — поддерживать структурированный снимок того, чего хочет пользователь, чтобы ассистент не терял цель в длинной беседе.

На вход — текущее состояние задачи (JSON) и последний обмен (сообщение пользователя + ответ ассистента).

Правила обновления:
- goal: если цель уже зафиксирована в текущем состоянии и пользователь явно её не меняет — верни ту же самую цель. Меняй только при явной смене темы пользователем. Если цели ещё нет и пользователь её явно формулирует — зафиксируй одной короткой фразой.
- constraints: добавляй ТОЛЬКО те ограничения, которые пользователь явно зафиксировал в своём последнем сообщении (например: «только open source», «PostgreSQL», «read-heavy»). Не придумывай ограничений, которых пользователь не произносил. Не удаляй уже зафиксированные ограничения — всегда возвращай их в списке.
- terms: добавляй термины только когда пользователь явно договорился об их значении в диалоге («под X понимаем Y»). Не удаляй уже согласованные термины.
- openQuestions: список неразрешённых уточняющих вопросов, которые мешают точному ответу. Добавляй новые, когда видно что нужна деталь. Убирай те, на которые пользователь уже ответил.
- resolvedFacts: добавляй выясненные в диалоге факты (по теме задачи), которые не подлежат пересмотру. Не удаляй уже зафиксированные факты.

ВАЖНО: ничего не придумывай, что пользователь явно не произнёс. Лучше оставить поле пустым/прежним, чем добавить ложное ограничение или термин.

Ответ — строго JSON объект по заданной схеме.`;

function mergeTaskStates(current: TaskState, payload: TaskStatePayload): TaskState {
  const goal = payload.goal && payload.goal.trim() ? payload.goal.trim() : current.goal;

  const constraintsSet = new Set(current.constraints);
  for (const c of payload.constraints) if (c.trim()) constraintsSet.add(c.trim());
  const constraints = Array.from(constraintsSet);

  const terms: Record<string, string> = { ...current.terms };
  for (const [k, v] of Object.entries(payload.terms)) {
    if (k.trim() && v.trim()) terms[k.trim()] = v.trim();
  }

  const openQuestions = payload.openQuestions.map((q) => q.trim()).filter(Boolean);

  const factsSet = new Set(current.resolvedFacts);
  for (const f of payload.resolvedFacts) if (f.trim()) factsSet.add(f.trim());
  const resolvedFacts = Array.from(factsSet);

  return {
    sessionId: current.sessionId,
    goal,
    constraints,
    terms,
    openQuestions,
    resolvedFacts,
    updatedAt: current.updatedAt,
  };
}

function statesEqual(a: TaskState, b: TaskState): boolean {
  if (a.goal !== b.goal) return false;
  if (a.constraints.length !== b.constraints.length) return false;
  for (let i = 0; i < a.constraints.length; i++) if (a.constraints[i] !== b.constraints[i]) return false;
  const aTerms = Object.keys(a.terms).sort();
  const bTerms = Object.keys(b.terms).sort();
  if (aTerms.length !== bTerms.length) return false;
  for (let i = 0; i < aTerms.length; i++) {
    if (aTerms[i] !== bTerms[i]) return false;
    if (a.terms[aTerms[i]] !== b.terms[bTerms[i]]) return false;
  }
  if (a.openQuestions.length !== b.openQuestions.length) return false;
  for (let i = 0; i < a.openQuestions.length; i++) if (a.openQuestions[i] !== b.openQuestions[i]) return false;
  if (a.resolvedFacts.length !== b.resolvedFacts.length) return false;
  for (let i = 0; i < a.resolvedFacts.length; i++) if (a.resolvedFacts[i] !== b.resolvedFacts[i]) return false;
  return true;
}

function parseTaskStatePayload(raw: string): TaskStatePayload {
  let jsonStr = raw.trim();
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();
  const parsed = JSON.parse(jsonStr);
  return TaskStatePayloadSchema.parse(parsed);
}

export class TaskStateService {
  constructor(
    private readonly taskStateRepo: TaskStateRepository,
    private readonly llmClient?: LLMClient,
    private readonly modelRepo?: ModelRepository,
  ) {}

  getState(sessionId: number): TaskState {
    return this.taskStateRepo.get(sessionId);
  }

  clear(sessionId: number): void {
    this.taskStateRepo.clear(sessionId);
  }

  upsert(state: TaskState): void {
    this.taskStateRepo.upsert(state);
  }

  async reconcile(
    sessionId: number,
    userMessage: string,
    assistantMessage: string,
  ): Promise<ReconcileResult> {
    const current = this.taskStateRepo.get(sessionId);

    if (!this.llmClient) {
      return { state: current, changed: false, inputTokens: 0, outputTokens: 0 };
    }

    const model = this.modelRepo?.getRole("facts");
    const modelId = model?.id ?? "openai/gpt-5-nano";

    const currentSnapshot = {
      goal: current.goal,
      constraints: current.constraints,
      terms: current.terms,
      openQuestions: current.openQuestions,
      resolvedFacts: current.resolvedFacts,
    };

    const userPrompt = [
      "Текущее состояние задачи:",
      JSON.stringify(currentSnapshot, null, 2),
      "",
      "Последний обмен:",
      `Пользователь: ${userMessage}`,
      `Ассистент: ${assistantMessage}`,
    ].join("\n");

    const request: LLMRequest = {
      messages: [{ id: 0, sessionId, role: "user", content: userPrompt, createdAt: "" }],
      instructions: RECONCILE_INSTRUCTIONS,
      model: modelId,
      params: {},
      responseFormat: taskStatePayloadToOpenAISchema() as any,
    };

    let response;
    try {
      response = await this.llmClient.send(request);
    } catch (error) {
      return {
        state: current,
        changed: false,
        inputTokens: 0,
        outputTokens: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    let payload: TaskStatePayload;
    try {
      payload = parseTaskStatePayload(response.content);
    } catch (error) {
      return {
        state: current,
        changed: false,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    const merged = mergeTaskStates(current, payload);
    const changed = !statesEqual(current, merged);

    if (changed) {
      this.taskStateRepo.upsert(merged);
    }

    const final = changed ? this.taskStateRepo.get(sessionId) : current;

    return {
      state: final,
      changed,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
    };
  }

  formatForDisplay(state: TaskState): string {
    if (isEmptyTaskState(state)) {
      return "Состояние задачи пустое.";
    }

    const parts: string[] = [];
    parts.push(`Цель: ${state.goal ?? "(не зафиксирована)"}`);

    if (state.constraints.length > 0) {
      parts.push("Ограничения:");
      for (const c of state.constraints) parts.push(`  - ${c}`);
    } else {
      parts.push("Ограничения: (нет)");
    }

    const termEntries = Object.entries(state.terms);
    if (termEntries.length > 0) {
      parts.push("Термины:");
      for (const [k, v] of termEntries) parts.push(`  - ${k} → ${v}`);
    } else {
      parts.push("Термины: (нет)");
    }

    if (state.openQuestions.length > 0) {
      parts.push("Открытые вопросы:");
      for (const q of state.openQuestions) parts.push(`  - ${q}`);
    } else {
      parts.push("Открытые вопросы: (нет)");
    }

    if (state.resolvedFacts.length > 0) {
      parts.push("Зафиксированные факты:");
      for (const f of state.resolvedFacts) parts.push(`  - ${f}`);
    }

    if (state.updatedAt) parts.push(`(обновлено: ${state.updatedAt})`);
    return parts.join("\n");
  }

  formatForPrompt(state: TaskState): string | null {
    if (isEmptyTaskState(state)) return null;

    const lines: string[] = ["[Состояние задачи]"];
    if (state.goal) lines.push(`Цель: ${state.goal}`);
    if (state.constraints.length > 0) {
      lines.push(`Ограничения: ${state.constraints.join("; ")}`);
    }
    const termEntries = Object.entries(state.terms);
    if (termEntries.length > 0) {
      lines.push(`Термины: ${termEntries.map(([k, v]) => `${k}=${v}`).join("; ")}`);
    }
    if (state.openQuestions.length > 0) {
      lines.push(`Открытые вопросы: ${state.openQuestions.join("; ")}`);
    }
    if (state.resolvedFacts.length > 0) {
      lines.push(`Зафиксированные факты: ${state.resolvedFacts.join("; ")}`);
    }
    return lines.join("\n");
  }

  formatForRawDisplay(state: TaskState): string {
    return JSON.stringify(state, null, 2);
  }
}
