import type { TaskTransition, TaskPhase } from "../../domain/models";
import type { TaskTransitionRepository } from "../../domain/ports/task-transition-repository";
import { getDb } from "../../db";

type DbTaskTransition = {
  id: number;
  task_id: number;
  from_phase: TaskPhase | null;
  to_phase: TaskPhase;
  triggered_by: "llm" | "system" | "user";
  created_at: string;
};

function toTransition(row: DbTaskTransition): TaskTransition {
  return {
    id: row.id,
    taskId: row.task_id,
    fromPhase: row.from_phase,
    toPhase: row.to_phase,
    triggeredBy: row.triggered_by,
    createdAt: row.created_at,
  };
}

export class SqliteTaskTransitionRepository implements TaskTransitionRepository {
  log(taskId: number, fromPhase: TaskPhase | null, toPhase: TaskPhase, triggeredBy: "llm" | "system" | "user"): void {
    const db = getDb();
    db.run(
      "INSERT INTO task_transitions (task_id, from_phase, to_phase, triggered_by) VALUES (?, ?, ?, ?)",
      [taskId, fromPhase, toPhase, triggeredBy]
    );
  }

  findByTaskId(taskId: number): TaskTransition[] {
    const db = getDb();
    const rows = db.query<DbTaskTransition, [number]>(
      "SELECT * FROM task_transitions WHERE task_id = ? ORDER BY id ASC"
    ).all(taskId);
    return rows.map(toTransition);
  }
}
