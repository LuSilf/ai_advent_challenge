import type { Task, TaskPhase } from "../models";

export interface TaskRepository {
  create(sessionId: number, title: string): number;
  findById(id: number): Task | null;
  findBySessionId(sessionId: number): Task[];
  findActive(sessionId: number): Task | null;
  update(id: number, fields: Partial<Pick<Task, "phase" | "previousPhase" | "summary">>): void;
}
