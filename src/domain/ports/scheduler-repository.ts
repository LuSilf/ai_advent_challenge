import type { ScheduledTask, ScheduleExecution } from "../models/scheduler";

export interface SchedulerRepository {
  createTask(task: Omit<ScheduledTask, "id" | "createdAt" | "lastRunAt">): number;
  findTaskById(id: number): ScheduledTask | null;
  findTasksBySessionId(sessionId: number): ScheduledTask[];
  findAllTasks(): ScheduledTask[];
  findDueTasks(now: string): ScheduledTask[];
  updateTask(id: number, fields: Partial<Pick<ScheduledTask, "enabled" | "lastRunAt" | "nextRunAt">>): void;
  deleteTask(id: number): boolean;

  addExecution(execution: Omit<ScheduleExecution, "id">): number;
  findExecutionsByTaskId(taskId: number, limit?: number): ScheduleExecution[];
  findRecentExecutions(limit?: number): ScheduleExecution[];
}
