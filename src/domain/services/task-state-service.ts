import type { TaskStateRepository } from "../ports/task-state-repository";
import { isEmptyTaskState, type TaskState } from "../models/task-state";

export class TaskStateService {
  constructor(
    private readonly taskStateRepo: TaskStateRepository,
  ) {}

  getState(sessionId: number): TaskState {
    return this.taskStateRepo.get(sessionId);
  }

  clear(sessionId: number): void {
    this.taskStateRepo.clear(sessionId);
  }

  upsert(state: TaskState): void {
    this.taskStateRepo.upsert(state);
  }

  formatForDisplay(state: TaskState): string {
    if (isEmptyTaskState(state)) {
      return "Состояние задачи пустое.";
    }

    const parts: string[] = [];
    parts.push(`Цель: ${state.goal ?? "(не зафиксирована)"}`);

    if (state.constraints.length > 0) {
      parts.push("Ограничения:");
      for (const c of state.constraints) parts.push(`  - ${c}`);
    } else {
      parts.push("Ограничения: (нет)");
    }

    const termEntries = Object.entries(state.terms);
    if (termEntries.length > 0) {
      parts.push("Термины:");
      for (const [k, v] of termEntries) parts.push(`  - ${k} → ${v}`);
    } else {
      parts.push("Термины: (нет)");
    }

    if (state.openQuestions.length > 0) {
      parts.push("Открытые вопросы:");
      for (const q of state.openQuestions) parts.push(`  - ${q}`);
    } else {
      parts.push("Открытые вопросы: (нет)");
    }

    if (state.resolvedFacts.length > 0) {
      parts.push("Зафиксированные факты:");
      for (const f of state.resolvedFacts) parts.push(`  - ${f}`);
    }

    if (state.updatedAt) parts.push(`(обновлено: ${state.updatedAt})`);
    return parts.join("\n");
  }

  formatForPrompt(state: TaskState): string | null {
    if (isEmptyTaskState(state)) return null;

    const lines: string[] = ["[Состояние задачи]"];
    if (state.goal) lines.push(`Цель: ${state.goal}`);
    if (state.constraints.length > 0) {
      lines.push(`Ограничения: ${state.constraints.join("; ")}`);
    }
    const termEntries = Object.entries(state.terms);
    if (termEntries.length > 0) {
      lines.push(`Термины: ${termEntries.map(([k, v]) => `${k}=${v}`).join("; ")}`);
    }
    if (state.openQuestions.length > 0) {
      lines.push(`Открытые вопросы: ${state.openQuestions.join("; ")}`);
    }
    if (state.resolvedFacts.length > 0) {
      lines.push(`Зафиксированные факты: ${state.resolvedFacts.join("; ")}`);
    }
    return lines.join("\n");
  }

  formatForRawDisplay(state: TaskState): string {
    return JSON.stringify(state, null, 2);
  }
}
