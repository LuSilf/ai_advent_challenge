import type { TaskStateRepository } from "../../domain/ports/task-state-repository";
import { createEmptyTaskState, type TaskState } from "../../domain/models/task-state";
import { getDb } from "../../db";

type TaskStateRow = {
  session_id: number;
  goal: string | null;
  constraints: string;
  terms: string;
  open_questions: string;
  resolved_facts: string;
  updated_at: string;
};

function parseJsonArray(raw: string): string[] {
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is string => typeof item === "string");
}

function parseJsonRecord(raw: string): Record<string, string> {
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

function rowToTaskState(row: TaskStateRow): TaskState {
  return {
    sessionId: row.session_id,
    goal: row.goal,
    constraints: parseJsonArray(row.constraints),
    terms: parseJsonRecord(row.terms),
    openQuestions: parseJsonArray(row.open_questions),
    resolvedFacts: parseJsonArray(row.resolved_facts),
    updatedAt: row.updated_at,
  };
}

export class SqliteTaskStateRepository implements TaskStateRepository {
  get(sessionId: number): TaskState {
    const db = getDb();
    const row = db.query<TaskStateRow, [number]>(
      "SELECT session_id, goal, constraints, terms, open_questions, resolved_facts, updated_at FROM task_states WHERE session_id = ?"
    ).get(sessionId);
    if (!row) return createEmptyTaskState(sessionId);
    return rowToTaskState(row);
  }

  upsert(state: TaskState): void {
    const db = getDb();
    db.run(
      `INSERT INTO task_states (session_id, goal, constraints, terms, open_questions, resolved_facts, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(session_id) DO UPDATE SET
         goal = excluded.goal,
         constraints = excluded.constraints,
         terms = excluded.terms,
         open_questions = excluded.open_questions,
         resolved_facts = excluded.resolved_facts,
         updated_at = excluded.updated_at`,
      [
        state.sessionId,
        state.goal,
        JSON.stringify(state.constraints),
        JSON.stringify(state.terms),
        JSON.stringify(state.openQuestions),
        JSON.stringify(state.resolvedFacts),
      ]
    );
  }

  clear(sessionId: number): void {
    const db = getDb();
    db.run("DELETE FROM task_states WHERE session_id = ?", [sessionId]);
  }
}
