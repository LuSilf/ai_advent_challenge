import type { TaskPhase } from "../models";

const TRANSITIONS: Record<TaskPhase, TaskPhase[]> = {
  planning:   ["execution", "paused", "cancelled"],
  execution:  ["validation", "planning", "paused", "cancelled"],
  validation: ["done", "execution", "paused", "cancelled"],
  paused:     ["planning", "execution", "validation"],
  done:       [],
  cancelled:  [],
};

// Переходы, доступные LLM (без paused — paused управляется только системой)
const LLM_TRANSITIONS: Record<TaskPhase, TaskPhase[]> = {
  planning:   ["execution", "cancelled"],
  execution:  ["validation", "planning", "cancelled"],
  validation: ["done", "execution", "cancelled"],
  paused:     ["planning", "execution", "validation"],
  done:       [],
  cancelled:  [],
};

export class TaskStateMachine {
  static canTransition(from: TaskPhase, to: TaskPhase): boolean {
    return TRANSITIONS[from].includes(to);
  }

  static getAllowedTransitions(from: TaskPhase): TaskPhase[] {
    return LLM_TRANSITIONS[from];
  }

  static describeTransitions(): string {
    return Object.entries(LLM_TRANSITIONS)
      .map(([phase, targets]) => {
        if (targets.length === 0) return `${phase} → (терминальное)`;
        return `${phase} → ${targets.join(" | ")}`;
      })
      .join("\n");
  }
}
