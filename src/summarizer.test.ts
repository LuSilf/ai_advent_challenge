import { describe, test, expect, mock } from "bun:test";
import { generateSummary } from "./summarizer";

function makeMockClient(outputText: string) {
  return {
    responses: {
      create: mock(async () => ({ output_text: outputText }))
    }
  } as any;
}

describe("generateSummary", () => {
  test("генерирует summary из сообщений без предыдущего резюме", async () => {
    const client = makeMockClient("Краткое резюме диалога");
    const result = await generateSummary(client, "test-model", null, [
      { role: "user", content: "привет" },
      { role: "assistant", content: "здравствуйте" }
    ]);

    expect(result).toBe("Краткое резюме диалога");
    expect(client.responses.create).toHaveBeenCalledTimes(1);

    const call = client.responses.create.mock.calls[0][0];
    expect(call.model).toBe("test-model");
    expect(call.input).toContain("Сообщения для создания резюме:");
    expect(call.input).toContain("привет");
  });

  test("кумулятивно обновляет существующий summary", async () => {
    const client = makeMockClient("Обновлённое резюме");
    const result = await generateSummary(client, "test-model", "Старое резюме", [
      { role: "user", content: "новый вопрос" },
      { role: "assistant", content: "новый ответ" }
    ]);

    expect(result).toBe("Обновлённое резюме");
    const call = client.responses.create.mock.calls[0][0];
    expect(call.input).toContain("Предыдущее резюме:");
    expect(call.input).toContain("Старое резюме");
    expect(call.input).toContain("новый вопрос");
  });

  test("возвращает пустую строку при пустом ответе", async () => {
    const client = makeMockClient("");
    const result = await generateSummary(client, "test-model", null, [
      { role: "user", content: "тест" }
    ]);
    expect(result).toBe("");
  });
});
