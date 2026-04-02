import type { Task, TaskPhase } from "../models";
import type { TaskRepository } from "../ports/task-repository";
import { TaskStateMachine } from "./task-state-machine";

export class TaskService {
  constructor(private readonly taskRepo: TaskRepository) {}

  createTask(sessionId: number, title: string): Task {
    const active = this.taskRepo.findActive(sessionId);
    if (active) {
      this.taskRepo.update(active.id, {
        phase: "paused",
        previousPhase: active.phase,
      });
    }

    const id = this.taskRepo.create(sessionId, title);
    return this.taskRepo.findById(id)!;
  }

  getActiveTask(sessionId: number): Task | null {
    return this.taskRepo.findActive(sessionId);
  }

  getSessionTasks(sessionId: number): Task[] {
    return this.taskRepo.findBySessionId(sessionId);
  }

  transition(taskId: number, targetPhase: TaskPhase): boolean {
    const task = this.taskRepo.findById(taskId);
    if (!task) return false;

    if (!TaskStateMachine.canTransition(task.phase, targetPhase)) return false;

    this.taskRepo.update(taskId, { phase: targetPhase });
    return true;
  }

  pauseTask(taskId: number): boolean {
    const task = this.taskRepo.findById(taskId);
    if (!task) return false;

    if (!TaskStateMachine.canTransition(task.phase, "paused")) return false;

    this.taskRepo.update(taskId, {
      phase: "paused",
      previousPhase: task.phase,
    });
    return true;
  }

  resumeTask(taskId: number): boolean {
    const task = this.taskRepo.findById(taskId);
    if (!task || task.phase !== "paused" || !task.previousPhase) return false;

    // Паузим текущую активную задачу в сессии
    const active = this.taskRepo.findActive(task.sessionId);
    if (active) {
      this.taskRepo.update(active.id, {
        phase: "paused",
        previousPhase: active.phase,
      });
    }

    this.taskRepo.update(taskId, {
      phase: task.previousPhase,
      previousPhase: null,
    });
    return true;
  }

  cancelTask(taskId: number): boolean {
    const task = this.taskRepo.findById(taskId);
    if (!task) return false;

    if (!TaskStateMachine.canTransition(task.phase, "cancelled")) return false;

    this.taskRepo.update(taskId, { phase: "cancelled" });
    return true;
  }

  pauseAllActive(sessionId: number): void {
    const tasks = this.taskRepo.findBySessionId(sessionId);
    for (const task of tasks) {
      if (!["paused", "done", "cancelled"].includes(task.phase)) {
        this.taskRepo.update(task.id, {
          phase: "paused",
          previousPhase: task.phase,
        });
      }
    }
  }

  updateStep(taskId: number, currentStep: string, expectedAction: string): void {
    this.taskRepo.update(taskId, { currentStep, expectedAction });
  }

  updateSummary(taskId: number, summary: string): void {
    this.taskRepo.update(taskId, { summary });
  }
}
