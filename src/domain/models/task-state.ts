import { z } from "zod";

export const TaskStateSchema = z.object({
  sessionId: z.number().int().positive(),
  goal: z.string().nullable(),
  constraints: z.array(z.string()),
  terms: z.record(z.string(), z.string()),
  openQuestions: z.array(z.string()),
  resolvedFacts: z.array(z.string()),
  updatedAt: z.string(),
});

export type TaskState = z.infer<typeof TaskStateSchema>;

export function createEmptyTaskState(sessionId: number): TaskState {
  return {
    sessionId,
    goal: null,
    constraints: [],
    terms: {},
    openQuestions: [],
    resolvedFacts: [],
    updatedAt: "",
  };
}

export function isEmptyTaskState(state: TaskState): boolean {
  return (
    state.goal === null
    && state.constraints.length === 0
    && Object.keys(state.terms).length === 0
    && state.openQuestions.length === 0
    && state.resolvedFacts.length === 0
  );
}

export const TaskStatePayloadSchema = z.object({
  goal: z.string().nullable(),
  constraints: z.array(z.string()),
  terms: z.record(z.string(), z.string()),
  openQuestions: z.array(z.string()),
  resolvedFacts: z.array(z.string()),
});

export type TaskStatePayload = z.infer<typeof TaskStatePayloadSchema>;

export function taskStatePayloadToOpenAISchema(): Record<string, unknown> {
  return {
    type: "json_schema",
    name: "task_state",
    strict: true,
    schema: {
      type: "object",
      required: ["goal", "constraints", "terms", "openQuestions", "resolvedFacts"],
      additionalProperties: false,
      properties: {
        goal: {
          type: ["string", "null"],
          description: "Основная цель диалога одной короткой фразой. null если цель ещё не зафиксирована",
        },
        constraints: {
          type: "array",
          description: "Ограничения, явно зафиксированные пользователем (например: «только open source», «PostgreSQL»).",
          items: { type: "string" },
        },
        terms: {
          type: "object",
          description: "Договорённая терминология: ключ — термин, значение — согласованное определение в рамках диалога.",
          additionalProperties: { type: "string" },
        },
        openQuestions: {
          type: "array",
          description: "Неразрешённые уточняющие вопросы, мешающие точному ответу.",
          items: { type: "string" },
        },
        resolvedFacts: {
          type: "array",
          description: "Выясненные в диалоге факты, которые не подлежат пересмотру без явной инверсии пользователем.",
          items: { type: "string" },
        },
      },
    },
  };
}
