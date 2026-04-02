import type { Task, TaskPhase } from "../../domain/models";
import type { TaskRepository } from "../../domain/ports/task-repository";
import { getDb } from "../../db";

type DbTask = {
  id: number;
  session_id: number;
  title: string;
  phase: TaskPhase;
  previous_phase: TaskPhase | null;
  current_step: string | null;
  expected_action: string | null;
  summary: string | null;
  created_at: string;
  updated_at: string;
};

function toTask(row: DbTask): Task {
  return {
    id: row.id,
    sessionId: row.session_id,
    title: row.title,
    phase: row.phase,
    previousPhase: row.previous_phase,
    currentStep: row.current_step,
    expectedAction: row.expected_action,
    summary: row.summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteTaskRepository implements TaskRepository {
  create(sessionId: number, title: string): number {
    const db = getDb();
    const result = db.run(
      "INSERT INTO tasks (session_id, title) VALUES (?, ?)",
      [sessionId, title]
    );
    return Number(result.lastInsertRowid);
  }

  findById(id: number): Task | null {
    const db = getDb();
    const row = db.query<DbTask, [number]>(
      "SELECT * FROM tasks WHERE id = ?"
    ).get(id);
    return row ? toTask(row) : null;
  }

  findBySessionId(sessionId: number): Task[] {
    const db = getDb();
    const rows = db.query<DbTask, [number]>(
      "SELECT * FROM tasks WHERE session_id = ? ORDER BY id ASC"
    ).all(sessionId);
    return rows.map(toTask);
  }

  findActive(sessionId: number): Task | null {
    const db = getDb();
    const row = db.query<DbTask, [number]>(
      "SELECT * FROM tasks WHERE session_id = ? AND phase NOT IN ('paused', 'done', 'cancelled') ORDER BY id DESC LIMIT 1"
    ).get(sessionId);
    return row ? toTask(row) : null;
  }

  update(id: number, fields: Partial<Pick<Task, "phase" | "previousPhase" | "currentStep" | "expectedAction" | "summary">>): void {
    const db = getDb();
    const sets: string[] = [];
    const values: unknown[] = [];

    if (fields.phase !== undefined) {
      sets.push("phase = ?");
      values.push(fields.phase);
    }
    if (fields.previousPhase !== undefined) {
      sets.push("previous_phase = ?");
      values.push(fields.previousPhase);
    }
    if (fields.currentStep !== undefined) {
      sets.push("current_step = ?");
      values.push(fields.currentStep);
    }
    if (fields.expectedAction !== undefined) {
      sets.push("expected_action = ?");
      values.push(fields.expectedAction);
    }
    if (fields.summary !== undefined) {
      sets.push("summary = ?");
      values.push(fields.summary);
    }

    if (sets.length === 0) return;

    sets.push("updated_at = datetime('now')");
    values.push(id);

    db.run(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, values);
  }
}
