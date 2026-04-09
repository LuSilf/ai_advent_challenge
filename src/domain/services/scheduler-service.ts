import { CronExpressionParser } from "cron-parser";
import type { ScheduledTask, ScheduleExecution } from "../models/scheduler";
import type { SchedulerRepository } from "../ports/scheduler-repository";
import type { ChatService, ToolProvider, SendMessageOptions } from "./chat-service";

export type SchedulerExecutionCallback = (task: ScheduledTask, result: ScheduleExecution) => void;

export type SchedulerDeps = {
  schedulerRepo: SchedulerRepository;
  chatService: ChatService;
  getSessionId: () => number;
  getSystemPrompt: () => string;
  getToolProvider?: () => ToolProvider | undefined;
  getMemoryBlocks?: () => string | undefined;
  getSendOptions?: () => Partial<SendMessageOptions>;
  onExecution?: SchedulerExecutionCallback;
};

export class SchedulerService {
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(private readonly deps: SchedulerDeps) {}

  // --- CRUD ---

  createTask(sessionId: number, name: string, cronExpression: string, prompt: string): number {
    const nextRunAt = this.computeNextRun(cronExpression);
    return this.deps.schedulerRepo.createTask({
      sessionId,
      name,
      cronExpression,
      prompt,
      enabled: true,
      nextRunAt,
    });
  }

  deleteTask(id: number): boolean {
    return this.deps.schedulerRepo.deleteTask(id);
  }

  getTask(id: number): ScheduledTask | null {
    return this.deps.schedulerRepo.findTaskById(id);
  }

  getSessionTasks(sessionId: number): ScheduledTask[] {
    return this.deps.schedulerRepo.findTasksBySessionId(sessionId);
  }

  getAllTasks(): ScheduledTask[] {
    return this.deps.schedulerRepo.findAllTasks();
  }

  enableTask(id: number): void {
    const task = this.deps.schedulerRepo.findTaskById(id);
    if (!task) return;
    const nextRunAt = this.computeNextRun(task.cronExpression);
    this.deps.schedulerRepo.updateTask(id, { enabled: true, nextRunAt });
  }

  disableTask(id: number): void {
    this.deps.schedulerRepo.updateTask(id, { enabled: false });
  }

  getExecutions(taskId: number, limit?: number): ScheduleExecution[] {
    return this.deps.schedulerRepo.findExecutionsByTaskId(taskId, limit);
  }

  getRecentExecutions(limit?: number): ScheduleExecution[] {
    return this.deps.schedulerRepo.findRecentExecutions(limit);
  }

  // --- Interval shortcuts ---

  /**
   * Parses interval shortcut like "every 30m", "every 2h", "every 1d"
   * Returns cron expression or null if not a valid interval.
   */
  parseInterval(input: string): string | null {
    const match = input.match(/^every\s+(\d+)\s*(m|min|h|hour|d|day)s?$/i);
    if (!match) return null;

    const value = Number(match[1]);
    const unit = match[2].toLowerCase();

    if (value <= 0) return null;

    switch (unit) {
      case "m":
      case "min":
        if (value > 59) return null;
        return `*/${value} * * * *`;
      case "h":
      case "hour":
        if (value > 23) return null;
        return `0 */${value} * * *`;
      case "d":
      case "day":
        if (value > 31) return null;
        return `0 0 */${value} * *`;
      default:
        return null;
    }
  }

  // --- Cron ---

  computeNextRun(cronExpression: string, from?: Date): string | null {
    try {
      const expr = CronExpressionParser.parse(cronExpression, { currentDate: from ?? new Date() });
      const next = expr.next();
      return next.toISOString();
    } catch {
      return null;
    }
  }

  validateCron(expression: string): boolean {
    try {
      CronExpressionParser.parse(expression);
      return true;
    } catch {
      return false;
    }
  }

  // --- Tick loop ---

  start(): void {
    if (this.running) return;
    this.running = true;
    this.tickInterval = setInterval(() => this.tick(), 60_000);
    // Run first tick immediately
    this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  private async tick(): Promise<void> {
    const now = new Date().toISOString();
    const dueTasks = this.deps.schedulerRepo.findDueTasks(now);

    for (const task of dueTasks) {
      await this.executeTask(task);
    }
  }

  async executeTask(task: ScheduledTask): Promise<ScheduleExecution> {
    const startedAt = new Date().toISOString();

    try {
      const sessionId = task.sessionId;
      const systemPrompt = this.deps.getSystemPrompt();
      const toolProvider = this.deps.getToolProvider?.();
      const memoryBlocks = this.deps.getMemoryBlocks?.();
      const extraOptions = this.deps.getSendOptions?.() ?? {};

      const result = await this.deps.chatService.sendMessage(sessionId, task.prompt, {
        historyLimit: 0,
        systemPrompt,
        useStreaming: false,
        memoryBlocks,
        toolProvider,
        ...extraOptions,
      });

      const finishedAt = new Date().toISOString();
      const tokens = (result.response.inputTokens ?? 0) + (result.response.outputTokens ?? 0);

      const execution: Omit<ScheduleExecution, "id"> = {
        taskId: task.id,
        status: "success",
        result: result.response.content,
        error: null,
        startedAt,
        finishedAt,
        tokensUsed: tokens,
      };

      const id = this.deps.schedulerRepo.addExecution(execution);

      // Update task timing
      const nextRunAt = this.computeNextRun(task.cronExpression);
      this.deps.schedulerRepo.updateTask(task.id, { lastRunAt: finishedAt, nextRunAt });

      const saved = { ...execution, id };
      this.deps.onExecution?.(task, saved);
      return saved;
    } catch (error) {
      const finishedAt = new Date().toISOString();
      const errorMsg = error instanceof Error ? error.message : String(error);

      const execution: Omit<ScheduleExecution, "id"> = {
        taskId: task.id,
        status: "error",
        result: null,
        error: errorMsg,
        startedAt,
        finishedAt,
        tokensUsed: 0,
      };

      const id = this.deps.schedulerRepo.addExecution(execution);

      const nextRunAt = this.computeNextRun(task.cronExpression);
      this.deps.schedulerRepo.updateTask(task.id, { lastRunAt: finishedAt, nextRunAt });

      const saved = { ...execution, id };
      this.deps.onExecution?.(task, saved);
      return saved;
    }
  }
}
