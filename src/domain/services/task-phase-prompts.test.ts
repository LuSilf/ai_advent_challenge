import { describe, test, expect } from "bun:test";
import { TaskPhasePrompts } from "./task-phase-prompts";
import type { Task } from "../models";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    sessionId: 1,
    title: "Реализовать фичу",
    phase: "planning",
    previousPhase: null,
    summary: null,
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

describe("TaskPhasePrompts", () => {
  describe("buildPhasePrompt", () => {
    test("planning промпт содержит название задачи и фазу", () => {
      const prompt = TaskPhasePrompts.buildPhasePrompt(makeTask());
      expect(prompt).toContain("Реализовать фичу");
      expect(prompt).toContain("ПЛАНИРОВАНИЕ");
    });

    test("execution промпт содержит фазу выполнения", () => {
      const prompt = TaskPhasePrompts.buildPhasePrompt(makeTask({ phase: "execution" }));
      expect(prompt).toContain("ВЫПОЛНЕНИЕ");
    });

    test("validation промпт содержит фазу проверки", () => {
      const prompt = TaskPhasePrompts.buildPhasePrompt(makeTask({ phase: "validation" }));
      expect(prompt).toContain("ПРОВЕРКА");
    });

    test("для paused/done/cancelled возвращает null", () => {
      expect(TaskPhasePrompts.buildPhasePrompt(makeTask({ phase: "paused" }))).toBeNull();
      expect(TaskPhasePrompts.buildPhasePrompt(makeTask({ phase: "done" }))).toBeNull();
      expect(TaskPhasePrompts.buildPhasePrompt(makeTask({ phase: "cancelled" }))).toBeNull();
    });

    test("промпт содержит инструкцию о маркерах в JSON формате", () => {
      const prompt = TaskPhasePrompts.buildPhasePrompt(makeTask());
      expect(prompt).toContain("<!--task-update");
      expect(prompt).toContain('"summary"');
      expect(prompt).toContain('"transition"');
    });
  });

  describe("parseTaskUpdate", () => {
    test("парсит JSON маркер с transition", () => {
      const text = `Отлично, план готов!\n<!--task-update\n{"transition": "execution", "summary": "План согласован"}\n-->`;
      const result = TaskPhasePrompts.parseTaskUpdate(text);
      expect(result).not.toBeNull();
      expect(result!.transition).toBe("execution");
      expect(result!.summary).toBe("План согласован");
    });

    test("парсит JSON маркер без transition (null)", () => {
      const text = `Работаем...\n<!--task-update\n{"transition": null, "summary": "Шаг 1 завершён"}\n-->`;
      const result = TaskPhasePrompts.parseTaskUpdate(text);
      expect(result).not.toBeNull();
      expect(result!.transition).toBeNull();
      expect(result!.summary).toBe("Шаг 1 завершён");
    });

    test("парсит простой текстовый маркер [TRANSITION: ...]", () => {
      const text = `Код готов!\n[TRANSITION: validation]\n[SUMMARY: реализация завершена]`;
      const result = TaskPhasePrompts.parseTaskUpdate(text);
      expect(result).not.toBeNull();
      expect(result!.transition).toBe("validation");
      expect(result!.summary).toBe("реализация завершена");
    });

    test("парсит простой маркер только с SUMMARY (без transition)", () => {
      const text = `Уточняю вопросы...\n[SUMMARY: ожидаем ответы пользователя]`;
      const result = TaskPhasePrompts.parseTaskUpdate(text);
      expect(result).not.toBeNull();
      expect(result!.transition).toBeNull();
      expect(result!.summary).toBe("ожидаем ответы пользователя");
    });

    test("возвращает null если маркера нет", () => {
      expect(TaskPhasePrompts.parseTaskUpdate("Просто текст")).toBeNull();
    });

    test("парсит маркер с невалидным JSON и без простых маркеров", () => {
      const text = `text\n<!--task-update\n{invalid}\n-->`;
      expect(TaskPhasePrompts.parseTaskUpdate(text)).toBeNull();
    });
  });

  describe("stripTaskMarkers", () => {
    test("удаляет JSON маркер task-update из текста", () => {
      const text = `Ответ\n<!--task-update\n{"transition": "execution"}\n-->`;
      const clean = TaskPhasePrompts.stripTaskMarkers(text);
      expect(clean).toBe("Ответ");
    });

    test("удаляет JSON маркер task-detect из текста", () => {
      const text = `Ответ\n<!--task-detect\n{"title": "Новая задача"}\n-->`;
      const clean = TaskPhasePrompts.stripTaskMarkers(text);
      expect(clean).toBe("Ответ");
    });

    test("удаляет простые текстовые маркеры", () => {
      const text = `Ответ\n[TRANSITION: execution]\n[SUMMARY: резюме]`;
      const clean = TaskPhasePrompts.stripTaskMarkers(text);
      expect(clean).toBe("Ответ");
    });

    test("удаляет маркер TASK-DETECT", () => {
      const text = `Ответ\n[TASK-DETECT: Новая задача]`;
      const clean = TaskPhasePrompts.stripTaskMarkers(text);
      expect(clean).toBe("Ответ");
    });

    test("не меняет текст без маркеров", () => {
      expect(TaskPhasePrompts.stripTaskMarkers("Просто текст")).toBe("Просто текст");
    });
  });

  describe("buildAutoDetectPrompt", () => {
    test("возвращает промпт автодетекта", () => {
      const prompt = TaskPhasePrompts.buildAutoDetectPrompt();
      expect(prompt).toContain("task-detect");
    });
  });

  describe("parseTaskDetect", () => {
    test("парсит JSON маркер task-detect", () => {
      const text = `Понял, вы хотите...\n<!--task-detect\n{"title": "Реализовать авторизацию"}\n-->`;
      const result = TaskPhasePrompts.parseTaskDetect(text);
      expect(result).not.toBeNull();
      expect(result!.title).toBe("Реализовать авторизацию");
    });

    test("парсит простой маркер [TASK-DETECT: ...]", () => {
      const text = `Понял!\n[TASK-DETECT: Реализовать парсер JSON]`;
      const result = TaskPhasePrompts.parseTaskDetect(text);
      expect(result).not.toBeNull();
      expect(result!.title).toBe("Реализовать парсер JSON");
    });

    test("возвращает null если маркера нет", () => {
      expect(TaskPhasePrompts.parseTaskDetect("Обычный ответ")).toBeNull();
    });
  });

  describe("buildInvalidTransitionMessage", () => {
    test("содержит текущую фазу и попытку перехода", () => {
      const task = makeTask({ phase: "planning" });
      const msg = TaskPhasePrompts.buildInvalidTransitionMessage(task, "done");
      expect(msg).toContain("planning → done");
      expect(msg).toContain("запрещён");
    });

    test("содержит допустимые переходы", () => {
      const task = makeTask({ phase: "planning" });
      const msg = TaskPhasePrompts.buildInvalidTransitionMessage(task, "done");
      expect(msg).toContain("execution");
      expect(msg).toContain("cancelled");
    });

    test("содержит граф переходов", () => {
      const task = makeTask({ phase: "planning" });
      const msg = TaskPhasePrompts.buildInvalidTransitionMessage(task, "done");
      expect(msg).toContain("validation");
      expect(msg).toContain("терминальное");
    });
  });

  describe("buildPhasePrompt содержит граф переходов", () => {
    test("planning промпт содержит допустимые переходы", () => {
      const prompt = TaskPhasePrompts.buildPhasePrompt(makeTask())!;
      expect(prompt).toContain("execution");
      expect(prompt).toContain("cancelled");
      expect(prompt).toContain("Допустимые переходы");
    });

    test("planning промпт содержит граф переходов", () => {
      const prompt = TaskPhasePrompts.buildPhasePrompt(makeTask())!;
      expect(prompt).toContain("Граф переходов");
      expect(prompt).toContain("терминальное");
    });

    test("промпт содержит инструкцию JSON-формата маркера", () => {
      const prompt = TaskPhasePrompts.buildPhasePrompt(makeTask())!;
      expect(prompt).toContain("<!--task-update");
      expect(prompt).toContain('"transition"');
    });
  });

});
