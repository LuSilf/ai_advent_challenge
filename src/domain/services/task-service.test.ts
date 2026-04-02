import { describe, test, expect, beforeEach } from "bun:test";
import { TaskService } from "./task-service";
import type { TaskRepository } from "../ports/task-repository";
import type { Task, TaskPhase } from "../models";

function createMockRepo(): TaskRepository & { tasks: Map<number, Task> } {
  let nextId = 1;
  const tasks = new Map<number, Task>();

  return {
    tasks,
    create(sessionId: number, title: string): number {
      const id = nextId++;
      tasks.set(id, {
        id,
        sessionId,
        title,
        phase: "planning" as TaskPhase,
        previousPhase: null,
        currentStep: null,
        expectedAction: null,
        summary: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      return id;
    },
    findById(id: number): Task | null {
      return tasks.get(id) ?? null;
    },
    findBySessionId(sessionId: number): Task[] {
      return [...tasks.values()].filter((t) => t.sessionId === sessionId);
    },
    findActive(sessionId: number): Task | null {
      return (
        [...tasks.values()].find(
          (t) =>
            t.sessionId === sessionId &&
            !["paused", "done", "cancelled"].includes(t.phase)
        ) ?? null
      );
    },
    update(id: number, fields: Partial<Pick<Task, "phase" | "previousPhase" | "currentStep" | "expectedAction" | "summary">>): void {
      const task = tasks.get(id);
      if (!task) return;
      if (fields.phase !== undefined) task.phase = fields.phase;
      if (fields.previousPhase !== undefined) task.previousPhase = fields.previousPhase;
      if (fields.currentStep !== undefined) task.currentStep = fields.currentStep;
      if (fields.expectedAction !== undefined) task.expectedAction = fields.expectedAction;
      if (fields.summary !== undefined) task.summary = fields.summary;
      task.updatedAt = new Date().toISOString();
    },
  };
}

describe("TaskService", () => {
  let repo: ReturnType<typeof createMockRepo>;
  let service: TaskService;

  beforeEach(() => {
    repo = createMockRepo();
    service = new TaskService(repo);
  });

  describe("createTask", () => {
    test("создаёт задачу в фазе planning", () => {
      const task = service.createTask(1, "Новая задача");
      expect(task.title).toBe("Новая задача");
      expect(task.phase).toBe("planning");
      expect(task.sessionId).toBe(1);
    });

    test("паузит предыдущую активную задачу при создании новой", () => {
      const task1 = service.createTask(1, "Задача 1");
      const task2 = service.createTask(1, "Задача 2");

      const updated1 = repo.findById(task1.id)!;
      expect(updated1.phase).toBe("paused");
      expect(updated1.previousPhase).toBe("planning");

      expect(task2.phase).toBe("planning");
    });

    test("не паузит задачи из другой сессии", () => {
      const task1 = service.createTask(1, "Сессия 1");
      service.createTask(2, "Сессия 2");

      const updated1 = repo.findById(task1.id)!;
      expect(updated1.phase).toBe("planning");
    });
  });

  describe("getActiveTask", () => {
    test("возвращает активную задачу", () => {
      const created = service.createTask(1, "Задача");
      const active = service.getActiveTask(1);
      expect(active).not.toBeNull();
      expect(active!.id).toBe(created.id);
    });

    test("возвращает null если нет активных задач", () => {
      expect(service.getActiveTask(1)).toBeNull();
    });
  });

  describe("getSessionTasks", () => {
    test("возвращает все задачи сессии", () => {
      service.createTask(1, "Задача 1");
      service.createTask(1, "Задача 2");
      service.createTask(2, "Чужая задача");

      const tasks = service.getSessionTasks(1);
      expect(tasks).toHaveLength(2);
    });

    test("возвращает пустой массив если задач нет", () => {
      expect(service.getSessionTasks(1)).toHaveLength(0);
    });
  });

  describe("updateStep", () => {
    test("обновляет currentStep и expectedAction", () => {
      const task = service.createTask(1, "Задача");
      service.updateStep(task.id, "Шаг 1", "Написать код");

      const updated = repo.findById(task.id)!;
      expect(updated.currentStep).toBe("Шаг 1");
      expect(updated.expectedAction).toBe("Написать код");
    });
  });

  describe("updateSummary", () => {
    test("обновляет summary", () => {
      const task = service.createTask(1, "Задача");
      service.updateSummary(task.id, "Обсуждаем план");

      const updated = repo.findById(task.id)!;
      expect(updated.summary).toBe("Обсуждаем план");
    });
  });
});
