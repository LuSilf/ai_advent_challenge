import { describe, test, expect, beforeEach } from "bun:test";
import { TaskService } from "./task-service";
import type { TaskRepository } from "../ports/task-repository";
import type { TaskTransitionRepository } from "../ports/task-transition-repository";
import type { Task, TaskPhase, TaskTransition } from "../models";

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

function createMockTransitionRepo(): TaskTransitionRepository & { transitions: TaskTransition[] } {
  let nextId = 1;
  const transitions: TaskTransition[] = [];

  return {
    transitions,
    log(taskId, fromPhase, toPhase, triggeredBy) {
      transitions.push({
        id: nextId++,
        taskId,
        fromPhase,
        toPhase,
        triggeredBy,
        createdAt: new Date().toISOString(),
      });
    },
    findByTaskId(taskId) {
      return transitions.filter((t) => t.taskId === taskId);
    },
  };
}

describe("TaskService", () => {
  let repo: ReturnType<typeof createMockRepo>;
  let transitionRepo: ReturnType<typeof createMockTransitionRepo>;
  let service: TaskService;

  beforeEach(() => {
    repo = createMockRepo();
    transitionRepo = createMockTransitionRepo();
    service = new TaskService(repo, transitionRepo);
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

    test("логирует переход null → planning при создании", () => {
      const task = service.createTask(1, "Задача");
      const transitions = transitionRepo.findByTaskId(task.id);
      expect(transitions).toHaveLength(1);
      expect(transitions[0].fromPhase).toBeNull();
      expect(transitions[0].toPhase).toBe("planning");
      expect(transitions[0].triggeredBy).toBe("user");
    });

    test("логирует паузу предыдущей задачи при создании новой", () => {
      const task1 = service.createTask(1, "Задача 1");
      service.createTask(1, "Задача 2");

      const transitions = transitionRepo.findByTaskId(task1.id);
      const pauseTransition = transitions.find((t) => t.toPhase === "paused");
      expect(pauseTransition).toBeDefined();
      expect(pauseTransition!.fromPhase).toBe("planning");
      expect(pauseTransition!.triggeredBy).toBe("system");
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

    test("логирует успешный переход", () => {
      const task = service.createTask(1, "Задача");
      service.transition(task.id, "execution", "llm");

      const transitions = transitionRepo.findByTaskId(task.id);
      const execTransition = transitions.find((t) => t.toPhase === "execution");
      expect(execTransition).toBeDefined();
      expect(execTransition!.fromPhase).toBe("planning");
      expect(execTransition!.triggeredBy).toBe("llm");
    });

    test("не логирует неудачный переход", () => {
      const task = service.createTask(1, "Задача");
      service.transition(task.id, "done", "llm");

      const transitions = transitionRepo.findByTaskId(task.id);
      // Только начальный null → planning
      expect(transitions).toHaveLength(1);
    });

    test("triggered_by по умолчанию llm", () => {
      const task = service.createTask(1, "Задача");
      service.transition(task.id, "execution");

      const transitions = transitionRepo.findByTaskId(task.id);
      const execTransition = transitions.find((t) => t.toPhase === "execution");
      expect(execTransition!.triggeredBy).toBe("llm");
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

    test("логирует отмену с triggered_by user", () => {
      const task = service.createTask(1, "Задача");
      service.cancelTask(task.id);

      const transitions = transitionRepo.findByTaskId(task.id);
      const cancelTransition = transitions.find((t) => t.toPhase === "cancelled");
      expect(cancelTransition).toBeDefined();
      expect(cancelTransition!.triggeredBy).toBe("user");
    });
  });

  describe("pauseAllActive", () => {
    test("паузит все активные задачи сессии", () => {
      const task1 = service.createTask(1, "Задача 1");
      const task2 = service.createTask(1, "Задача 2");
      service.pauseAllActive(1);
      expect(repo.findById(task2.id)!.phase).toBe("paused");
    });

    test("не трогает задачи другой сессии", () => {
      const task1 = service.createTask(1, "Задача сессии 1");
      const task2 = service.createTask(2, "Задача сессии 2");
      service.pauseAllActive(1);
      expect(repo.findById(task2.id)!.phase).toBe("planning");
    });

    test("логирует паузу с triggered_by system", () => {
      const task = service.createTask(1, "Задача");
      service.pauseAllActive(1);

      const transitions = transitionRepo.findByTaskId(task.id);
      const pauseTransition = transitions.find((t) => t.toPhase === "paused");
      expect(pauseTransition).toBeDefined();
      expect(pauseTransition!.triggeredBy).toBe("system");
    });
  });

  describe("getTaskTransitions", () => {
    test("возвращает историю переходов задачи", () => {
      const task = service.createTask(1, "Задача");
      service.transition(task.id, "execution");
      service.transition(task.id, "validation");

      const transitions = service.getTaskTransitions(task.id);
      expect(transitions).toHaveLength(3);
      expect(transitions[0].toPhase).toBe("planning");
      expect(transitions[1].toPhase).toBe("execution");
      expect(transitions[2].toPhase).toBe("validation");
    });
  });
});
