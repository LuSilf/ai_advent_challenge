import { describe, test, expect } from "bun:test";
import { TaskStateMachine } from "./task-state-machine";
import type { TaskPhase } from "../models";

describe("TaskStateMachine", () => {
  describe("допустимые переходы", () => {
    test("planning → execution", () => {
      expect(TaskStateMachine.canTransition("planning", "execution")).toBe(true);
    });

    test("planning → paused", () => {
      expect(TaskStateMachine.canTransition("planning", "paused")).toBe(true);
    });

    test("planning → cancelled", () => {
      expect(TaskStateMachine.canTransition("planning", "cancelled")).toBe(true);
    });

    test("execution → validation", () => {
      expect(TaskStateMachine.canTransition("execution", "validation")).toBe(true);
    });

    test("execution → planning (откат)", () => {
      expect(TaskStateMachine.canTransition("execution", "planning")).toBe(true);
    });

    test("execution → paused", () => {
      expect(TaskStateMachine.canTransition("execution", "paused")).toBe(true);
    });

    test("execution → cancelled", () => {
      expect(TaskStateMachine.canTransition("execution", "cancelled")).toBe(true);
    });

    test("validation → done", () => {
      expect(TaskStateMachine.canTransition("validation", "done")).toBe(true);
    });

    test("validation → execution (откат)", () => {
      expect(TaskStateMachine.canTransition("validation", "execution")).toBe(true);
    });

    test("validation → paused", () => {
      expect(TaskStateMachine.canTransition("validation", "paused")).toBe(true);
    });

    test("validation → cancelled", () => {
      expect(TaskStateMachine.canTransition("validation", "cancelled")).toBe(true);
    });
  });

  describe("недопустимые переходы", () => {
    test("planning → done", () => {
      expect(TaskStateMachine.canTransition("planning", "done")).toBe(false);
    });

    test("planning → validation", () => {
      expect(TaskStateMachine.canTransition("planning", "validation")).toBe(false);
    });

    test("execution → done", () => {
      expect(TaskStateMachine.canTransition("execution", "done")).toBe(false);
    });

    test("validation → planning", () => {
      expect(TaskStateMachine.canTransition("validation", "planning")).toBe(false);
    });

    test("переход в ту же фазу", () => {
      expect(TaskStateMachine.canTransition("planning", "planning")).toBe(false);
      expect(TaskStateMachine.canTransition("execution", "execution")).toBe(false);
    });
  });

  describe("терминальные состояния", () => {
    const terminalPhases: TaskPhase[] = ["done", "cancelled"];
    const allPhases: TaskPhase[] = ["planning", "execution", "validation", "done", "paused", "cancelled"];

    for (const terminal of terminalPhases) {
      for (const target of allPhases) {
        test(`${terminal} → ${target} запрещён`, () => {
          expect(TaskStateMachine.canTransition(terminal, target)).toBe(false);
        });
      }
    }
  });

  describe("paused", () => {
    test("paused → planning (resume)", () => {
      expect(TaskStateMachine.canTransition("paused", "planning")).toBe(true);
    });

    test("paused → execution (resume)", () => {
      expect(TaskStateMachine.canTransition("paused", "execution")).toBe(true);
    });

    test("paused → validation (resume)", () => {
      expect(TaskStateMachine.canTransition("paused", "validation")).toBe(true);
    });

    test("paused → done запрещён", () => {
      expect(TaskStateMachine.canTransition("paused", "done")).toBe(false);
    });

    test("paused → cancelled запрещён", () => {
      expect(TaskStateMachine.canTransition("paused", "cancelled")).toBe(false);
    });

    test("paused → paused запрещён", () => {
      expect(TaskStateMachine.canTransition("paused", "paused")).toBe(false);
    });
  });

  describe("getAllowedTransitions", () => {
    test("planning допускает execution и cancelled", () => {
      const allowed = TaskStateMachine.getAllowedTransitions("planning");
      expect(allowed).toContain("execution");
      expect(allowed).toContain("cancelled");
      expect(allowed).not.toContain("paused");
      expect(allowed).not.toContain("done");
      expect(allowed).not.toContain("validation");
    });

    test("execution допускает validation, planning и cancelled", () => {
      const allowed = TaskStateMachine.getAllowedTransitions("execution");
      expect(allowed).toContain("validation");
      expect(allowed).toContain("planning");
      expect(allowed).toContain("cancelled");
      expect(allowed).not.toContain("done");
      expect(allowed).not.toContain("paused");
    });

    test("validation допускает done, execution и cancelled", () => {
      const allowed = TaskStateMachine.getAllowedTransitions("validation");
      expect(allowed).toContain("done");
      expect(allowed).toContain("execution");
      expect(allowed).toContain("cancelled");
      expect(allowed).not.toContain("planning");
      expect(allowed).not.toContain("paused");
    });

    test("done возвращает пустой массив", () => {
      expect(TaskStateMachine.getAllowedTransitions("done")).toHaveLength(0);
    });

    test("cancelled возвращает пустой массив", () => {
      expect(TaskStateMachine.getAllowedTransitions("cancelled")).toHaveLength(0);
    });

    test("paused допускает planning, execution, validation", () => {
      const allowed = TaskStateMachine.getAllowedTransitions("paused");
      expect(allowed).toContain("planning");
      expect(allowed).toContain("execution");
      expect(allowed).toContain("validation");
    });
  });

  describe("describeTransitions", () => {
    test("возвращает строку с описанием всех фаз", () => {
      const desc = TaskStateMachine.describeTransitions();
      expect(desc).toContain("planning");
      expect(desc).toContain("execution");
      expect(desc).toContain("validation");
      expect(desc).toContain("done");
      expect(desc).toContain("cancelled");
    });

    test("терминальные фазы помечены", () => {
      const desc = TaskStateMachine.describeTransitions();
      expect(desc).toMatch(/done.*терминальное|done.*terminal/i);
      expect(desc).toMatch(/cancelled.*терминальное|cancelled.*terminal/i);
    });
  });
});
