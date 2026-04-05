import type { Task, TaskPhase, TaskTransition } from "../models";
import type { TaskRepository } from "../ports/task-repository";
import type { TaskTransitionRepository } from "../ports/task-transition-repository";
import { TaskStateMachine } from "./task-state-machine";

export class TaskService {
  constructor(
    private readonly taskRepo: TaskRepository,
    private readonly transitionRepo: TaskTransitionRepository,
  ) {}

  createTask(sessionId: number, title: string): Task {
    const active = this.taskRepo.findActive(sessionId);
    if (active) {
      const fromPhase = active.phase;
      this.taskRepo.update(active.id, {
        phase: "paused",
        previousPhase: fromPhase,
      });
      this.transitionRepo.log(active.id, fromPhase, "paused", "system");
    }

    const id = this.taskRepo.create(sessionId, title);
    this.transitionRepo.log(id, null, "planning", "user");
    return this.taskRepo.findById(id)!;
  }

  getActiveTask(sessionId: number): Task | null {
    return this.taskRepo.findActive(sessionId);
  }

  getSessionTasks(sessionId: number): Task[] {
    return this.taskRepo.findBySessionId(sessionId);
  }

  transition(taskId: number, targetPhase: TaskPhase, triggeredBy: "llm" | "system" | "user" = "llm"): boolean {
    const task = this.taskRepo.findById(taskId);
    if (!task) return false;

    const fromPhase = task.phase;
    if (!TaskStateMachine.canTransition(fromPhase, targetPhase)) return false;

    this.taskRepo.update(taskId, { phase: targetPhase });
    this.transitionRepo.log(taskId, fromPhase, targetPhase, triggeredBy);
    return true;
  }

  cancelTask(taskId: number): boolean {
    const task = this.taskRepo.findById(taskId);
    if (!task) return false;

    const fromPhase = task.phase;
    if (!TaskStateMachine.canTransition(fromPhase, "cancelled")) return false;

    this.taskRepo.update(taskId, { phase: "cancelled" });
    this.transitionRepo.log(taskId, fromPhase, "cancelled", "user");
    return true;
  }

  pauseTask(taskId: number): boolean {
    const task = this.taskRepo.findById(taskId);
    if (!task) return false;

    const fromPhase = task.phase;
    if (!TaskStateMachine.canTransition(fromPhase, "paused")) return false;

    this.taskRepo.update(taskId, {
      phase: "paused",
      previousPhase: fromPhase,
    });
    this.transitionRepo.log(taskId, fromPhase, "paused", "system");
    return true;
  }

  resumeTask(taskId: number): boolean {
    const task = this.taskRepo.findById(taskId);
    if (!task || task.phase !== "paused" || !task.previousPhase) return false;

    const active = this.taskRepo.findActive(task.sessionId);
    if (active) {
      const activeFromPhase = active.phase;
      this.taskRepo.update(active.id, {
        phase: "paused",
        previousPhase: activeFromPhase,
      });
      this.transitionRepo.log(active.id, activeFromPhase, "paused", "system");
    }

    const fromPhase = task.phase;
    const toPhase = task.previousPhase;
    this.taskRepo.update(taskId, {
      phase: toPhase,
      previousPhase: null,
    });
    this.transitionRepo.log(taskId, fromPhase, toPhase, "system");
    return true;
  }

  pauseAllActive(sessionId: number): void {
    const tasks = this.taskRepo.findBySessionId(sessionId);
    for (const task of tasks) {
      if (!["paused", "done", "cancelled"].includes(task.phase)) {
        const fromPhase = task.phase;
        this.taskRepo.update(task.id, {
          phase: "paused",
          previousPhase: fromPhase,
        });
        this.transitionRepo.log(task.id, fromPhase, "paused", "system");
      }
    }
  }

  updateSummary(taskId: number, summary: string): void {
    this.taskRepo.update(taskId, { summary });
  }

  getTaskTransitions(taskId: number): TaskTransition[] {
    return this.transitionRepo.findByTaskId(taskId);
  }
}
