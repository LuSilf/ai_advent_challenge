import type { TaskPhase } from "../models";

const TRANSITIONS: Record<TaskPhase, TaskPhase[]> = {
  planning:   ["execution", "paused", "cancelled"],
  execution:  ["validation", "planning", "paused", "cancelled"],
  validation: ["done", "execution", "paused", "cancelled"],
  paused:     ["planning", "execution", "validation"],
  done:       [],
  cancelled:  [],
};

export class TaskStateMachine {
  static canTransition(from: TaskPhase, to: TaskPhase): boolean {
    return TRANSITIONS[from].includes(to);
  }
}
