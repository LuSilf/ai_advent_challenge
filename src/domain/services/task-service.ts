import type { Task } from "../models";
import type { TaskRepository } from "../ports/task-repository";

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

  updateStep(taskId: number, currentStep: string, expectedAction: string): void {
    this.taskRepo.update(taskId, { currentStep, expectedAction });
  }

  updateSummary(taskId: number, summary: string): void {
    this.taskRepo.update(taskId, { summary });
  }
}
