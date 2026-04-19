import { z } from "zod";

export const CitedRagResponseSchema = z.object({
  answer: z.string().describe("Основной ответ на вопрос пользователя"),
  confidence: z.enum(["high", "low", "insufficient"]).describe(
    "Оценка достаточности контекста: high — ответ полностью подкреплён источниками, low — частично, insufficient — контекст не позволяет ответить",
  ),
  sources: z
    .array(
      z.object({
        sourceIndex: z.number().int().describe("Номер источника из контекста [Источник N]"),
        source: z.string().describe("Имя документа"),
        section: z.string().nullable().describe("Секция/breadcrumb или null"),
      }),
    )
    .describe("Список использованных источников"),
  quotes: z
    .array(
      z.object({
        sourceIndex: z.number().int().describe("К какому источнику относится цитата"),
        text: z.string().describe("Дословная цитата из найденного чанка"),
      }),
    )
    .describe("Цитаты из найденных материалов, подтверждающие ответ"),
});

export type CitedRagResponse = z.infer<typeof CitedRagResponseSchema>;

export function citedRagResponseToOpenAISchema(): Record<string, unknown> {
  return {
    type: "json_schema",
    name: "cited_rag_response",
    strict: true,
    schema: {
      type: "object",
      required: ["answer", "confidence", "sources", "quotes"],
      additionalProperties: false,
      properties: {
        answer: { type: "string", description: "Основной ответ на вопрос пользователя" },
        confidence: {
          type: "string",
          enum: ["high", "low", "insufficient"],
          description: "Оценка достаточности контекста",
        },
        sources: {
          type: "array",
          description: "Список использованных источников",
          items: {
            type: "object",
            required: ["sourceIndex", "source", "section"],
            additionalProperties: false,
            properties: {
              sourceIndex: { type: "integer", description: "Номер источника из контекста [Источник N]" },
              source: { type: "string", description: "Имя документа" },
              section: {
                type: ["string", "null"],
                description: "Секция/breadcrumb или null",
              },
            },
          },
        },
        quotes: {
          type: "array",
          description: "Цитаты из найденных материалов",
          items: {
            type: "object",
            required: ["sourceIndex", "text"],
            additionalProperties: false,
            properties: {
              sourceIndex: { type: "integer", description: "К какому источнику относится" },
              text: { type: "string", description: "Дословная цитата из чанка" },
            },
          },
        },
      },
    },
  };
}

export function parseCitedRagResponse(raw: string): CitedRagResponse | null {
  try {
    const parsed = JSON.parse(raw);
    const result = CitedRagResponseSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
