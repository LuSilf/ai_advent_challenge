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
    currentStep: null,
    expectedAction: null,
    summary: null,
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

describe("TaskPhasePrompts", () => {
  describe("buildPhasePrompt", () => {
    test("planning промпт содержит название задачи", () => {
      const prompt = TaskPhasePrompts.buildPhasePrompt(makeTask());
      expect(prompt).toContain("Реализовать фичу");
      expect(prompt).toContain("ПЛАНИРОВАНИЯ");
    });

    test("execution промпт содержит фазу выполнения", () => {
      const prompt = TaskPhasePrompts.buildPhasePrompt(makeTask({ phase: "execution" }));
      expect(prompt).toContain("ВЫПОЛНЕНИЯ");
    });

    test("validation промпт содержит фазу проверки", () => {
      const prompt = TaskPhasePrompts.buildPhasePrompt(makeTask({ phase: "validation" }));
      expect(prompt).toContain("ПРОВЕРКИ");
    });

    test("промпт включает currentStep если задан", () => {
      const prompt = TaskPhasePrompts.buildPhasePrompt(makeTask({ currentStep: "Шаг 1" }));
      expect(prompt).toContain("Шаг 1");
    });

    test("промпт включает expectedAction если задан", () => {
      const prompt = TaskPhasePrompts.buildPhasePrompt(makeTask({ expectedAction: "Написать код" }));
      expect(prompt).toContain("Написать код");
    });

    test("для paused/done/cancelled возвращает null", () => {
      expect(TaskPhasePrompts.buildPhasePrompt(makeTask({ phase: "paused" }))).toBeNull();
      expect(TaskPhasePrompts.buildPhasePrompt(makeTask({ phase: "done" }))).toBeNull();
      expect(TaskPhasePrompts.buildPhasePrompt(makeTask({ phase: "cancelled" }))).toBeNull();
    });

    test("промпт содержит инструкцию о маркере task-update", () => {
      const prompt = TaskPhasePrompts.buildPhasePrompt(makeTask());
      expect(prompt).toContain("task-update");
    });
  });

  describe("parseTaskUpdate", () => {
    test("парсит маркер с transition", () => {
      const text = `Отлично, план готов!\n<!--task-update\n{"transition": "execution", "currentStep": "Реализация API", "expectedAction": "Написать endpoint", "summary": "План согласован"}\n-->`;
      const result = TaskPhasePrompts.parseTaskUpdate(text);
      expect(result).not.toBeNull();
      expect(result!.transition).toBe("execution");
      expect(result!.currentStep).toBe("Реализация API");
      expect(result!.expectedAction).toBe("Написать endpoint");
      expect(result!.summary).toBe("План согласован");
    });

    test("парсит маркер без transition (null)", () => {
      const text = `Работаем...\n<!--task-update\n{"transition": null, "currentStep": "Шаг 2", "expectedAction": "Тестировать", "summary": "Шаг 1 завершён"}\n-->`;
      const result = TaskPhasePrompts.parseTaskUpdate(text);
      expect(result).not.toBeNull();
      expect(result!.transition).toBeNull();
      expect(result!.currentStep).toBe("Шаг 2");
    });

    test("возвращает null если маркера нет", () => {
      expect(TaskPhasePrompts.parseTaskUpdate("Просто текст")).toBeNull();
    });

    test("парсит маркер с невалидным JSON", () => {
      const text = `text\n<!--task-update\n{invalid}\n-->`;
      expect(TaskPhasePrompts.parseTaskUpdate(text)).toBeNull();
    });
  });

  describe("stripTaskMarkers", () => {
    test("удаляет маркер task-update из текста", () => {
      const text = `Ответ\n<!--task-update\n{"transition": "execution"}\n-->`;
      const clean = TaskPhasePrompts.stripTaskMarkers(text);
      expect(clean).toBe("Ответ");
    });

    test("удаляет маркер task-detect из текста", () => {
      const text = `Ответ\n<!--task-detect\n{"title": "Новая задача"}\n-->`;
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
    test("парсит маркер task-detect", () => {
      const text = `Понял, вы хотите...\n<!--task-detect\n{"title": "Реализовать авторизацию"}\n-->`;
      const result = TaskPhasePrompts.parseTaskDetect(text);
      expect(result).not.toBeNull();
      expect(result!.title).toBe("Реализовать авторизацию");
    });

    test("возвращает null если маркера нет", () => {
      expect(TaskPhasePrompts.parseTaskDetect("Обычный ответ")).toBeNull();
    });
  });
});
