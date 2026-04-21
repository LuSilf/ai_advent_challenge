import type { TaskState } from "../models/task-state";

export interface TaskStateRepository {
  get(sessionId: number): TaskState;
  upsert(state: TaskState): void;
  clear(sessionId: number): void;
}
