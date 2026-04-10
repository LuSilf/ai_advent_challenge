export type ScheduledTask = {
  id: number;
  sessionId: number;
  name: string;
  cronExpression: string;
  prompt: string;
  enabled: boolean;
  createdAt: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
};

export type ExecutionStatus = "success" | "error";

export type ScheduleExecution = {
  id: number;
  taskId: number;
  status: ExecutionStatus;
  result: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  tokensUsed: number;
};
