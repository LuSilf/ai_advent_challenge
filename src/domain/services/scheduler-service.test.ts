import { describe, test, expect, beforeEach, mock } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SchedulerService } from "./scheduler-service";
import { SqliteSchedulerRepository } from "../../storage/sqlite/scheduler-repository";
import { initDb, getDb } from "../../db";
import type { ChatService, SendMessageResult } from "./chat-service";

function freshDb(): void {
  const path = join(tmpdir(), `test-scheduler-svc-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  initDb(path);
  getDb().run("INSERT INTO sessions (title) VALUES (?)", ["test-session"]);
}

function mockChatService(response: string = "mock response"): ChatService {
  return {
    sendMessage: mock(async (): Promise<SendMessageResult> => ({
      response: { content: response, inputTokens: 10, outputTokens: 20 },
      costInfo: null,
      model: { id: "test", name: "test", inputPrice: 0, outputPrice: 0, contextSize: 1000 },
    })),
  } as unknown as ChatService;
}

describe("SchedulerService", () => {
  let repo: SqliteSchedulerRepository;
  let chatService: ChatService;
  let service: SchedulerService;

  beforeEach(() => {
    freshDb();
    repo = new SqliteSchedulerRepository();
    chatService = mockChatService();
    service = new SchedulerService({
      schedulerRepo: repo,
      chatService,
      getSessionId: () => 1,
      getSystemPrompt: () => "test prompt",
    });
  });

  // --- CRUD ---

  test("createTask creates a task with computed nextRunAt", () => {
    const id = service.createTask(1, "test", "*/5 * * * *", "do something");
    const task = service.getTask(id);
    expect(task).not.toBeNull();
    expect(task!.name).toBe("test");
    expect(task!.cronExpression).toBe("*/5 * * * *");
    expect(task!.prompt).toBe("do something");
    expect(task!.enabled).toBe(true);
    expect(task!.nextRunAt).not.toBeNull();
  });

  test("deleteTask removes task", () => {
    const id = service.createTask(1, "t", "* * * * *", "p");
    expect(service.deleteTask(id)).toBe(true);
    expect(service.getTask(id)).toBeNull();
  });

  test("getSessionTasks returns only tasks for session", () => {
    getDb().run("INSERT INTO sessions (title) VALUES (?)", ["session2"]);
    service.createTask(1, "t1", "* * * * *", "p1");
    service.createTask(2, "t2", "* * * * *", "p2");
    expect(service.getSessionTasks(1)).toHaveLength(1);
  });

  test("enableTask / disableTask toggle enabled flag", () => {
    const id = service.createTask(1, "t", "* * * * *", "p");
    service.disableTask(id);
    expect(service.getTask(id)!.enabled).toBe(false);
    service.enableTask(id);
    expect(service.getTask(id)!.enabled).toBe(true);
    expect(service.getTask(id)!.nextRunAt).not.toBeNull();
  });

  // --- Cron validation ---

  test("validateCron accepts valid expressions", () => {
    expect(service.validateCron("*/5 * * * *")).toBe(true);
    expect(service.validateCron("0 */2 * * *")).toBe(true);
    expect(service.validateCron("0 9 * * 1-5")).toBe(true);
  });

  test("validateCron rejects invalid expressions", () => {
    expect(service.validateCron("not a cron")).toBe(false);
    expect(service.validateCron("99 99 99 99 99")).toBe(false);
  });

  test("computeNextRun returns ISO date for valid cron", () => {
    const next = service.computeNextRun("*/5 * * * *", new Date("2026-01-01T00:00:00Z"));
    expect(next).not.toBeNull();
    expect(new Date(next!).getTime()).toBeGreaterThan(new Date("2026-01-01T00:00:00Z").getTime());
  });

  test("computeNextRun returns null for invalid cron", () => {
    expect(service.computeNextRun("invalid")).toBeNull();
  });

  // --- Execution ---

  test("executeTask calls chatService and saves execution", async () => {
    const id = service.createTask(1, "test", "*/5 * * * *", "tell joke");
    const task = service.getTask(id)!;

    const execution = await service.executeTask(task);
    expect(execution.status).toBe("success");
    expect(execution.result).toBe("mock response");
    expect(execution.tokensUsed).toBe(30);

    const saved = service.getExecutions(id);
    expect(saved).toHaveLength(1);
    expect(saved[0].status).toBe("success");

    // Task timing updated
    const updated = service.getTask(id)!;
    expect(updated.lastRunAt).not.toBeNull();
    expect(updated.nextRunAt).not.toBeNull();
  });

  test("executeTask handles errors", async () => {
    const failChat = {
      sendMessage: mock(async () => { throw new Error("LLM down"); }),
    } as unknown as ChatService;

    const failService = new SchedulerService({
      schedulerRepo: repo,
      chatService: failChat,
      getSessionId: () => 1,
      getSystemPrompt: () => "test",
    });

    const id = failService.createTask(1, "fail", "*/5 * * * *", "p");
    const task = failService.getTask(id)!;

    const execution = await failService.executeTask(task);
    expect(execution.status).toBe("error");
    expect(execution.error).toContain("LLM down");
  });

  test("executeTask fires onExecution callback", async () => {
    const callback = mock(() => {});
    const cbService = new SchedulerService({
      schedulerRepo: repo,
      chatService,
      getSessionId: () => 1,
      getSystemPrompt: () => "test",
      onExecution: callback,
    });

    const id = cbService.createTask(1, "cb-test", "*/5 * * * *", "p");
    const task = cbService.getTask(id)!;
    await cbService.executeTask(task);

    expect(callback).toHaveBeenCalledTimes(1);
  });

  // --- Start/Stop ---

  test("start and stop toggle running state", () => {
    expect(service.isRunning()).toBe(false);
    service.start();
    expect(service.isRunning()).toBe(true);
    service.stop();
    expect(service.isRunning()).toBe(false);
  });
});
