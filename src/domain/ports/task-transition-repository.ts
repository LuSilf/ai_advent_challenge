import type { TaskTransition, TaskPhase } from "../models";

export interface TaskTransitionRepository {
  log(taskId: number, fromPhase: TaskPhase | null, toPhase: TaskPhase, triggeredBy: "llm" | "system" | "user"): void;
  findByTaskId(taskId: number): TaskTransition[];
}
