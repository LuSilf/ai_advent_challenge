import { describe, test, expect, beforeEach, mock } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initDb, createSession, addMessage, getSummary, upsertSummary } from "./db";
import { buildContext } from "./context-builder";

function freshDb(): string {
  const path = join(tmpdir(), `test-ctx-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  initDb(path);
  return path;
}

function makeMockClient(summaryText: string = "Мок-резюме") {
  return {
    responses: {
      create: mock(async () => ({ output_text: summaryText }))
    }
  } as any;
}

describe("buildContext", () => {
  beforeEach(() => {
    freshDb();
  });

  test("сообщений <= tailSize — возвращает все без summary", async () => {
    const id = createSession();
    addMessage(id, "user", "привет");
    addMessage(id, "assistant", "здравствуйте");

    const client = makeMockClient();
    const result = await buildContext(client, "model", id, 10);

    expect(result.summaryUsed).toBe(false);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].content).toBe("привет");
    expect(client.responses.create).not.toHaveBeenCalled();
  });

  test("сообщений > tailSize — генерирует summary + последние N", async () => {
    const id = createSession();
    // 6 сообщений, tailSize = 2 → 4 старых, 2 в tail
    addMessage(id, "user", "msg1");
    addMessage(id, "assistant", "msg2");
    addMessage(id, "user", "msg3");
    addMessage(id, "assistant", "msg4");
    addMessage(id, "user", "msg5");
    addMessage(id, "assistant", "msg6");

    const client = makeMockClient("Резюме: обсуждали msg1-msg4");
    const result = await buildContext(client, "model", id, 2);

    expect(result.summaryUsed).toBe(true);
    expect(result.messages).toHaveLength(3); // summary + 2 tail
    expect(result.messages[0].content).toBe("Резюме: обсуждали msg1-msg4");
    expect(result.messages[1].content).toBe("msg5");
    expect(result.messages[2].content).toBe("msg6");

    // Summary сохранён в БД
    const summary = getSummary(id);
    expect(summary).not.toBeNull();
    expect(summary!.message_count).toBe(4);
    expect(client.responses.create).toHaveBeenCalledTimes(1);
  });

  test("при наличии актуального summary — не вызывает summarizer", async () => {
    const id = createSession();
    addMessage(id, "user", "msg1");
    addMessage(id, "assistant", "msg2");
    addMessage(id, "user", "msg3");
    addMessage(id, "assistant", "msg4");

    // Summary уже покрывает 2 старых сообщения
    upsertSummary(id, "Существующее резюме", 2);

    const client = makeMockClient();
    const result = await buildContext(client, "model", id, 2);

    expect(result.summaryUsed).toBe(true);
    expect(result.messages[0].content).toBe("Существующее резюме");
    expect(result.messages).toHaveLength(3); // summary + 2 tail
    expect(client.responses.create).not.toHaveBeenCalled();
  });

  test("при частично устаревшем summary — дополняет его", async () => {
    const id = createSession();
    addMessage(id, "user", "msg1");
    addMessage(id, "assistant", "msg2");
    addMessage(id, "user", "msg3");
    addMessage(id, "assistant", "msg4");
    addMessage(id, "user", "msg5");
    addMessage(id, "assistant", "msg6");

    // Summary покрывает только 2 из 4 старых
    upsertSummary(id, "Старое резюме", 2);

    const client = makeMockClient("Обновлённое резюме");
    const result = await buildContext(client, "model", id, 2);

    expect(result.summaryUsed).toBe(true);
    expect(result.messages[0].content).toBe("Обновлённое резюме");
    expect(client.responses.create).toHaveBeenCalledTimes(1);

    const summary = getSummary(id);
    expect(summary!.message_count).toBe(4);
  });
});
