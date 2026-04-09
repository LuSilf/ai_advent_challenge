import type { ScheduledTask, ScheduleExecution, ExecutionStatus } from "../../domain/models/scheduler";
import type { SchedulerRepository } from "../../domain/ports/scheduler-repository";
import { getDb } from "../../db";

type DbScheduledTask = {
  id: number;
  session_id: number;
  name: string;
  cron_expression: string;
  prompt: string;
  enabled: number;
  created_at: string;
  last_run_at: string | null;
  next_run_at: string | null;
};

type DbScheduleExecution = {
  id: number;
  task_id: number;
  status: ExecutionStatus;
  result: string | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
  tokens_used: number;
};

function toTask(row: DbScheduledTask): ScheduledTask {
  return {
    id: row.id,
    sessionId: row.session_id,
    name: row.name,
    cronExpression: row.cron_expression,
    prompt: row.prompt,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
  };
}

function toExecution(row: DbScheduleExecution): ScheduleExecution {
  return {
    id: row.id,
    taskId: row.task_id,
    status: row.status,
    result: row.result,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    tokensUsed: row.tokens_used,
  };
}

export class SqliteSchedulerRepository implements SchedulerRepository {
  createTask(task: Omit<ScheduledTask, "id" | "createdAt" | "lastRunAt">): number {
    const db = getDb();
    const result = db.run(
      "INSERT INTO scheduled_tasks (session_id, name, cron_expression, prompt, enabled, next_run_at) VALUES (?, ?, ?, ?, ?, ?)",
      [task.sessionId, task.name, task.cronExpression, task.prompt, task.enabled ? 1 : 0, task.nextRunAt],
    );
    return Number(result.lastInsertRowid);
  }

  findTaskById(id: number): ScheduledTask | null {
    const db = getDb();
    const row = db.query<DbScheduledTask, [number]>("SELECT * FROM scheduled_tasks WHERE id = ?").get(id);
    return row ? toTask(row) : null;
  }

  findTasksBySessionId(sessionId: number): ScheduledTask[] {
    const db = getDb();
    return db
      .query<DbScheduledTask, [number]>("SELECT * FROM scheduled_tasks WHERE session_id = ? ORDER BY id ASC")
      .all(sessionId)
      .map(toTask);
  }

  findAllTasks(): ScheduledTask[] {
    const db = getDb();
    return db.query<DbScheduledTask, []>("SELECT * FROM scheduled_tasks ORDER BY id ASC").all().map(toTask);
  }

  findDueTasks(now: string): ScheduledTask[] {
    const db = getDb();
    return db
      .query<DbScheduledTask, [string]>(
        "SELECT * FROM scheduled_tasks WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at ASC",
      )
      .all(now)
      .map(toTask);
  }

  updateTask(id: number, fields: Partial<Pick<ScheduledTask, "enabled" | "lastRunAt" | "nextRunAt">>): void {
    const db = getDb();
    const sets: string[] = [];
    const values: unknown[] = [];

    if (fields.enabled !== undefined) {
      sets.push("enabled = ?");
      values.push(fields.enabled ? 1 : 0);
    }
    if (fields.lastRunAt !== undefined) {
      sets.push("last_run_at = ?");
      values.push(fields.lastRunAt);
    }
    if (fields.nextRunAt !== undefined) {
      sets.push("next_run_at = ?");
      values.push(fields.nextRunAt);
    }

    if (sets.length === 0) return;
    values.push(id);
    db.run(`UPDATE scheduled_tasks SET ${sets.join(", ")} WHERE id = ?`, values);
  }

  deleteTask(id: number): boolean {
    const db = getDb();
    const result = db.run("DELETE FROM scheduled_tasks WHERE id = ?", [id]);
    return result.changes > 0;
  }

  addExecution(execution: Omit<ScheduleExecution, "id">): number {
    const db = getDb();
    const result = db.run(
      "INSERT INTO schedule_executions (task_id, status, result, error, started_at, finished_at, tokens_used) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        execution.taskId,
        execution.status,
        execution.result,
        execution.error,
        execution.startedAt,
        execution.finishedAt,
        execution.tokensUsed,
      ],
    );
    return Number(result.lastInsertRowid);
  }

  findExecutionsByTaskId(taskId: number, limit = 20): ScheduleExecution[] {
    const db = getDb();
    return db
      .query<DbScheduleExecution, [number, number]>(
        "SELECT * FROM schedule_executions WHERE task_id = ? ORDER BY id DESC LIMIT ?",
      )
      .all(taskId, limit)
      .map(toExecution);
  }

  findRecentExecutions(limit = 20): ScheduleExecution[] {
    const db = getDb();
    return db
      .query<DbScheduleExecution, [number]>("SELECT * FROM schedule_executions ORDER BY id DESC LIMIT ?")
      .all(limit)
      .map(toExecution);
  }
}
