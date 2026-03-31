import { describe, test, expect, beforeEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initDb, createSession, addMessage, upsertFacts } from "./db";
import {
  FullStrategy,
  SlidingWindowStrategy,
  StickyFactsStrategy,
  createStrategy,
  isValidStrategy,
  formatFactsBlock,
  buildFactsExtractionInput,
  parseFactsResponse,
} from "./strategy";

function freshDb(): string {
  const path = join(tmpdir(), `test-strategy-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  initDb(path);
  return path;
}

describe("FullStrategy", () => {
  beforeEach(() => { freshDb(); });

  test("возвращает все сообщения без ограничений", () => {
    const id = createSession();
    for (let i = 1; i <= 10; i++) {
      addMessage(id, i % 2 === 1 ? "user" : "assistant", `msg ${i}`);
    }

    const strategy = new FullStrategy();
    const result = strategy.buildMessages(id, 3);

    expect(result.messages).toHaveLength(10);
    expect(result.messages[0].content).toBe("msg 1");
    expect(result.messages[9].content).toBe("msg 10");
    expect(result.factsBlock).toBeUndefined();
  });

  test("пустая сессия возвращает пустой массив", () => {
    const id = createSession();
    const strategy = new FullStrategy();
    const result = strategy.buildMessages(id, 50);
    expect(result.messages).toHaveLength(0);
  });
});

describe("SlidingWindowStrategy", () => {
  beforeEach(() => { freshDb(); });

  test("возвращает только последние N сообщений", () => {
    const id = createSession();
    for (let i = 1; i <= 10; i++) {
      addMessage(id, i % 2 === 1 ? "user" : "assistant", `msg ${i}`);
    }

    const strategy = new SlidingWindowStrategy();
    const result = strategy.buildMessages(id, 4);

    expect(result.messages).toHaveLength(4);
    expect(result.messages[0].content).toBe("msg 7");
    expect(result.messages[3].content).toBe("msg 10");
  });

  test("если сообщений меньше лимита, возвращает все", () => {
    const id = createSession();
    addMessage(id, "user", "hello");
    addMessage(id, "assistant", "hi");

    const strategy = new SlidingWindowStrategy();
    const result = strategy.buildMessages(id, 50);

    expect(result.messages).toHaveLength(2);
  });
});

describe("createStrategy", () => {
  test("создаёт FullStrategy по имени 'full'", () => {
    const s = createStrategy("full");
    expect(s.name).toBe("full");
  });

  test("создаёт SlidingWindowStrategy по имени 'sliding'", () => {
    const s = createStrategy("sliding");
    expect(s.name).toBe("sliding");
  });

  test("'facts' возвращает SlidingWindowStrategy для обратной совместимости", () => {
    const s = createStrategy("facts");
    expect(s.name).toBe("sliding");
  });

  test("бросает ошибку для неизвестной стратегии", () => {
    expect(() => createStrategy("unknown")).toThrow("Неизвестная стратегия");
  });
});

describe("isValidStrategy", () => {
  test("допустимые стратегии", () => {
    expect(isValidStrategy("full")).toBe(true);
    expect(isValidStrategy("sliding")).toBe(true);
  });

  test("facts больше не допустимая стратегия", () => {
    expect(isValidStrategy("facts")).toBe(false);
  });

  test("недопустимые стратегии", () => {
    expect(isValidStrategy("unknown")).toBe(false);
    expect(isValidStrategy("")).toBe(false);
  });
});

describe("StickyFactsStrategy", () => {
  beforeEach(() => { freshDb(); });

  test("без фактов возвращает только сообщения", () => {
    const id = createSession();
    addMessage(id, "user", "hello");
    addMessage(id, "assistant", "hi");

    const strategy = new StickyFactsStrategy();
    const result = strategy.buildMessages(id, 50);

    expect(result.messages).toHaveLength(2);
    expect(result.factsBlock).toBeUndefined();
  });

  test("с фактами возвращает factsBlock", () => {
    const id = createSession();
    addMessage(id, "user", "hello");
    upsertFacts(id, [
      { key: "цель", value: "тестирование" },
      { key: "язык", value: "TypeScript" },
    ]);

    const strategy = new StickyFactsStrategy();
    const result = strategy.buildMessages(id, 50);

    expect(result.factsBlock).toBeDefined();
    expect(result.factsBlock).toContain("цель: тестирование");
    expect(result.factsBlock).toContain("язык: TypeScript");
  });

  test("использует historyLimit для окна сообщений", () => {
    const id = createSession();
    for (let i = 1; i <= 10; i++) {
      addMessage(id, i % 2 === 1 ? "user" : "assistant", `msg ${i}`);
    }

    const strategy = new StickyFactsStrategy();
    const result = strategy.buildMessages(id, 4);

    expect(result.messages).toHaveLength(4);
    expect(result.messages[0].content).toBe("msg 7");
  });
});

describe("formatFactsBlock", () => {
  test("форматирует факты в блок", () => {
    const block = formatFactsBlock([
      { key: "цель", value: "тест" },
      { key: "язык", value: "JS" },
    ]);
    expect(block).toBe("Известные факты из диалога:\n- цель: тест\n- язык: JS");
  });
});

describe("buildFactsExtractionInput", () => {
  test("без текущих фактов", () => {
    const input = buildFactsExtractionInput([], "привет", "ответ");
    expect(input).toContain("Пользователь: привет");
    expect(input).toContain("Ассистент: ответ");
    expect(input).not.toContain("Текущие факты");
  });

  test("с текущими фактами", () => {
    const input = buildFactsExtractionInput(
      [{ key: "цель", value: "тест" }],
      "привет",
      "ответ"
    );
    expect(input).toContain("Текущие факты");
    expect(input).toContain('"цель"');
  });
});

describe("parseFactsResponse", () => {
  test("парсит простой JSON", () => {
    const facts = parseFactsResponse('{"цель": "тестирование", "язык": "TS"}');
    expect(facts).toHaveLength(2);
    expect(facts[0]).toEqual({ key: "цель", value: "тестирование" });
  });

  test("парсит JSON в code block", () => {
    const facts = parseFactsResponse('```json\n{"a": "b"}\n```');
    expect(facts).toHaveLength(1);
    expect(facts[0]).toEqual({ key: "a", value: "b" });
  });

  test("бросает ошибку на невалидный JSON", () => {
    expect(() => parseFactsResponse("not json")).toThrow();
  });

  test("бросает ошибку на массив", () => {
    expect(() => parseFactsResponse("[1,2,3]")).toThrow("Ожидался JSON объект");
  });
});
