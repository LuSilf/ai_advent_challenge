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
    update(id: number, fields: Partial<Pick<Task, "phase" | "previousPhase" | "summary">>): void {
      const task = tasks.get(id);
      if (!task) return;
      if (fields.phase !== undefined) task.phase = fields.phase;
      if (fields.previousPhase !== undefined) task.previousPhase = fields.previousPhase;
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

  describe("updateSummary", () => {
    test("обновляет summary", () => {
      const task = service.createTask(1, "Задача");
      service.updateSummary(task.id, "Обсуждаем план");

      const updated = repo.findById(task.id)!;
      expect(updated.summary).toBe("Обсуждаем план");
    });
  });

  describe("transition", () => {
    test("planning → execution допустим", () => {
      const task = service.createTask(1, "Задача");
      const ok = service.transition(task.id, "execution");
      expect(ok).toBe(true);
      expect(repo.findById(task.id)!.phase).toBe("execution");
    });

    test("execution → validation допустим", () => {
      const task = service.createTask(1, "Задача");
      service.transition(task.id, "execution");
      const ok = service.transition(task.id, "validation");
      expect(ok).toBe(true);
      expect(repo.findById(task.id)!.phase).toBe("validation");
    });

    test("validation → done допустим", () => {
      const task = service.createTask(1, "Задача");
      service.transition(task.id, "execution");
      service.transition(task.id, "validation");
      const ok = service.transition(task.id, "done");
      expect(ok).toBe(true);
      expect(repo.findById(task.id)!.phase).toBe("done");
    });

    test("validation → execution (откат) допустим", () => {
      const task = service.createTask(1, "Задача");
      service.transition(task.id, "execution");
      service.transition(task.id, "validation");
      const ok = service.transition(task.id, "execution");
      expect(ok).toBe(true);
      expect(repo.findById(task.id)!.phase).toBe("execution");
    });

    test("execution → planning (откат) допустим", () => {
      const task = service.createTask(1, "Задача");
      service.transition(task.id, "execution");
      const ok = service.transition(task.id, "planning");
      expect(ok).toBe(true);
      expect(repo.findById(task.id)!.phase).toBe("planning");
    });

    test("planning → done недопустим", () => {
      const task = service.createTask(1, "Задача");
      const ok = service.transition(task.id, "done");
      expect(ok).toBe(false);
      expect(repo.findById(task.id)!.phase).toBe("planning");
    });

    test("несуществующая задача возвращает false", () => {
      expect(service.transition(999, "execution")).toBe(false);
    });
  });

  describe("pauseTask", () => {
    test("ставит задачу на паузу, сохраняя previousPhase", () => {
      const task = service.createTask(1, "Задача");
      service.transition(task.id, "execution");
      const ok = service.pauseTask(task.id);
      expect(ok).toBe(true);
      const updated = repo.findById(task.id)!;
      expect(updated.phase).toBe("paused");
      expect(updated.previousPhase).toBe("execution");
    });

    test("нельзя запаузить done задачу", () => {
      const task = service.createTask(1, "Задача");
      service.transition(task.id, "execution");
      service.transition(task.id, "validation");
      service.transition(task.id, "done");
      const ok = service.pauseTask(task.id);
      expect(ok).toBe(false);
    });

    test("несуществующая задача возвращает false", () => {
      expect(service.pauseTask(999)).toBe(false);
    });
  });

  describe("resumeTask", () => {
    test("возвращает задачу в previousPhase", () => {
      const task = service.createTask(1, "Задача");
      service.transition(task.id, "execution");
      service.pauseTask(task.id);
      const ok = service.resumeTask(task.id);
      expect(ok).toBe(true);
      expect(repo.findById(task.id)!.phase).toBe("execution");
    });

    test("паузит текущую активную при resume", () => {
      const task1 = service.createTask(1, "Задача 1");
      service.pauseTask(task1.id);
      const task2 = service.createTask(1, "Задача 2");

      service.resumeTask(task1.id);
      expect(repo.findById(task1.id)!.phase).toBe("planning");
      expect(repo.findById(task2.id)!.phase).toBe("paused");
    });

    test("нельзя resume не-paused задачу", () => {
      const task = service.createTask(1, "Задача");
      expect(service.resumeTask(task.id)).toBe(false);
    });

    test("несуществующая задача возвращает false", () => {
      expect(service.resumeTask(999)).toBe(false);
    });
  });

  describe("cancelTask", () => {
    test("отменяет задачу", () => {
      const task = service.createTask(1, "Задача");
      const ok = service.cancelTask(task.id);
      expect(ok).toBe(true);
      expect(repo.findById(task.id)!.phase).toBe("cancelled");
    });

    test("нельзя отменить done задачу", () => {
      const task = service.createTask(1, "Задача");
      service.transition(task.id, "execution");
      service.transition(task.id, "validation");
      service.transition(task.id, "done");
      expect(service.cancelTask(task.id)).toBe(false);
    });
  });

  describe("pauseAllActive", () => {
    test("паузит все активные задачи сессии", () => {
      const task1 = service.createTask(1, "Задача 1");
      // task1 is paused by createTask of task2
      const task2 = service.createTask(1, "Задача 2");
      // only task2 is active
      service.pauseAllActive(1);
      expect(repo.findById(task2.id)!.phase).toBe("paused");
    });

    test("не трогает задачи другой сессии", () => {
      const task1 = service.createTask(1, "Задача сессии 1");
      const task2 = service.createTask(2, "Задача сессии 2");
      service.pauseAllActive(1);
      expect(repo.findById(task2.id)!.phase).toBe("planning");
    });
  });
});
