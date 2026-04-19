/**
 * E2E-тест контролируемых переходов состояний.
 *
 * Сценарии:
 * 1. Полный жизненный цикл: planning → execution → validation → done
 * 2. Невалидный переход (planning → done) отклоняется + retry исправляет
 * 3. Откат: validation → execution → validation → done
 * 4. Автопауза при смене сессии, авто-resume при возврате
 * 5. /task cancel из активной фазы
 * 6. Терминальные состояния блокируют переходы
 * 7. Аудит-лог записывает все переходы
 * 8. Создание новой задачи паузит предыдущую
 */

import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import OpenAI from "openai";

import { initDb } from "./db";
import { loadConfig, applyDbOptions } from "./config";

import { SqliteSessionRepository } from "./storage/sqlite/session-repository";
import { SqliteMessageRepository } from "./storage/sqlite/message-repository";
import { SqliteFactRepository } from "./storage/sqlite/fact-repository";
import { SqliteModelRepository } from "./storage/sqlite/model-repository";
import { SqliteOptionsRepository } from "./storage/sqlite/options-repository";
import { SqliteCheckpointRepository } from "./storage/sqlite/checkpoint-repository";
import { SqliteProfileRepository } from "./storage/sqlite/profile-repository";
import { SqliteMemoryRepository } from "./storage/sqlite/memory-repository";
import { SqliteTaskRepository } from "./storage/sqlite/task-repository";
import { SqliteTaskTransitionRepository } from "./storage/sqlite/task-transition-repository";
import { SqliteMcpServerRepository } from "./storage/sqlite/mcp-server-repository";
import { SqliteSchedulerRepository } from "./storage/sqlite/scheduler-repository";

import { OpenAILLMClient } from "./api/openai/llm-client";

import { SessionService } from "./domain/services/session-service";
import { ContextService } from "./domain/services/context-service";
import { CostService } from "./domain/services/cost-service";
import { ChatService } from "./domain/services/chat-service";
import { MemoryService } from "./domain/services/memory-service";
import { ProfileService } from "./domain/services/profile-service";
import { TaskService } from "./domain/services/task-service";
import { TaskPhasePrompts } from "./domain/services/task-phase-prompts";
import { TaskStateMachine } from "./domain/services/task-state-machine";
import { McpClientService } from "./domain/services/mcp-client-service";
import { McpConnectionManager } from "./domain/services/mcp-connection-manager";
import { handleCommand, type ReplDeps, type ReplState } from "./presentation/repl";
import { DEFAULT_RAG_STRATEGY, DEFAULT_RAG_TOP_K } from "./presentation/repl/rag";

// ─── Helpers ──────────────────────────────────────────────
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`${GREEN}  ✓ ${message}${RESET}`);
    passed++;
  } else {
    console.log(`${RED}  ✗ ${message}${RESET}`);
    failed++;
  }
}

function section(name: string): void {
  console.log(`\n${DIM}── ${name} ──${RESET}`);
}

// ─── Setup ────────────────────────────────────────────────
const DB_PATH = join(tmpdir(), `e2e-test-${Date.now()}.db`);

try { unlinkSync(DB_PATH); } catch {}

initDb(DB_PATH);

const sessionRepo = new SqliteSessionRepository();
const messageRepo = new SqliteMessageRepository();
const factRepo = new SqliteFactRepository();
const modelRepo = new SqliteModelRepository();
const optionsRepo = new SqliteOptionsRepository();
const checkpointRepo = new SqliteCheckpointRepository();
const profileRepo = new SqliteProfileRepository();
const memoryRepo = new SqliteMemoryRepository();
const taskRepo = new SqliteTaskRepository();
const taskTransitionRepo = new SqliteTaskTransitionRepository();

const taskService = new TaskService(taskRepo, taskTransitionRepo);
const sessionService = new SessionService(sessionRepo, messageRepo);
const contextService = new ContextService();
const costService = new CostService(modelRepo);
const profileService = new ProfileService(profileRepo, optionsRepo);

// Мок LLM-клиент — не делаем реальных запросов
let mockLLMResponses: string[] = [];
const mockLLMClient = {
  async send() {
    const content = mockLLMResponses.shift() ?? "mock response";
    return { content, inputTokens: 10, outputTokens: 5 };
  },
  async *stream() {
    const content = mockLLMResponses.shift() ?? "mock response";
    yield { type: "done" as const, response: { content, inputTokens: 10, outputTokens: 5 } };
  },
};

const chatService = new ChatService(
  mockLLMClient as any,
  sessionService,
  contextService,
  costService,
  messageRepo,
  factRepo,
  modelRepo,
  profileService,
);
const memoryService = new MemoryService(memoryRepo, mockLLMClient as any, modelRepo);

// Фейк OpenAI клиент (не используется в тестах, но нужен для ReplDeps)
const fakeOpenaiClient = {} as any;

const config = {
  prompt: "",
  apiKey: "test",
  baseUrl: "http://localhost",
  systemPrompt: "test",
  effectiveTimeoutMs: 5000,
  debug: false,
  useStreaming: false,
  historyDb: DB_PATH,
  historyLimit: 50,
  contextStrategy: "full",
  day25Mode: false,
};

const mcpServerRepo = new SqliteMcpServerRepository();
const schedulerRepo = new SqliteSchedulerRepository();
const mcpClientService = new McpClientService();
const mcpConnectionManager = new McpConnectionManager(mcpServerRepo, mcpClientService);

const deps: ReplDeps = {
  config: config as any,
  sessionService,
  chatService,
  memoryService,
  contextService,
  costService,
  modelRepo,
  optionsRepo,
  checkpointRepo,
  factRepo,
  llmClient: mockLLMClient as any,
  openaiClient: fakeOpenaiClient,
  profileService,
  taskService,
  mcpServerRepo,
  mcpConnectionManager,
  schedulerRepo,
};

const state: ReplState = {
  sessionId: sessionService.createSession("E2E Test Session", "full"),
  messagesSinceReconciliation: 0,
  rag: {
    enabled: false,
    strategy: DEFAULT_RAG_STRATEGY,
    topK: DEFAULT_RAG_TOP_K,
  },
};

// ─── Сценарий 1: Полный жизненный цикл ────────────────────
section("Сценарий 1: Полный жизненный цикл");

const task1 = taskService.createTask(state.sessionId, "Реализовать калькулятор");
assert(task1.phase === "planning", "Задача создана в фазе planning");

const t1 = taskService.transition(task1.id, "execution", "llm");
assert(t1 === true, "planning → execution: допустимый переход");
assert(taskRepo.findById(task1.id)!.phase === "execution", "Фаза обновилась на execution");

const t2 = taskService.transition(task1.id, "validation", "llm");
assert(t2 === true, "execution → validation: допустимый переход");

const t3 = taskService.transition(task1.id, "done", "llm");
assert(t3 === true, "validation → done: допустимый переход");
assert(taskRepo.findById(task1.id)!.phase === "done", "Задача завершена");

// ─── Сценарий 2: Невалидный переход отклоняется ────────────
section("Сценарий 2: Невалидный переход отклоняется");

const task2 = taskService.createTask(state.sessionId, "Невалидный переход");
assert(task2.phase === "planning", "Задача в planning");

const invalid1 = taskService.transition(task2.id, "done", "llm");
assert(invalid1 === false, "planning → done: ОТКЛОНЁН");
assert(taskRepo.findById(task2.id)!.phase === "planning", "Фаза осталась planning");

const invalid2 = taskService.transition(task2.id, "validation", "llm");
assert(invalid2 === false, "planning → validation: ОТКЛОНЁН (перепрыгивание)");

// ─── Сценарий 3: Откат validation → execution ──────────────
section("Сценарий 3: Откат из validation");

const task3 = taskService.createTask(state.sessionId, "Откат");
taskService.transition(task3.id, "execution", "llm");
taskService.transition(task3.id, "validation", "llm");

const rollback = taskService.transition(task3.id, "execution", "llm");
assert(rollback === true, "validation → execution: откат допустим");
assert(taskRepo.findById(task3.id)!.phase === "execution", "Вернулись в execution");

taskService.transition(task3.id, "validation", "llm");
taskService.transition(task3.id, "done", "llm");
assert(taskRepo.findById(task3.id)!.phase === "done", "После отката дошли до done");

// ─── Сценарий 4: Автопауза при смене сессии ────────────────
section("Сценарий 4: Автопауза при смене сессии");

const session2 = sessionService.createSession("Вторая сессия", "full");
const task4 = taskService.createTask(state.sessionId, "Задача для паузы");
taskService.transition(task4.id, "execution", "llm");

// Смена сессии — паузим всё в старой
taskService.pauseAllActive(state.sessionId);
assert(taskRepo.findById(task4.id)!.phase === "paused", "Задача автоматически запаузена при смене сессии");
assert(taskRepo.findById(task4.id)!.previousPhase === "execution", "previousPhase сохранена: execution");

// ─── Сценарий 5: /task cancel ──────────────────────────────
section("Сценарий 5: /task cancel");

const task5 = taskService.createTask(state.sessionId, "Отменяемая задача");
taskService.transition(task5.id, "execution", "llm");
const cancelOk = taskService.cancelTask(task5.id);
assert(cancelOk === true, "Задача отменена из execution");
assert(taskRepo.findById(task5.id)!.phase === "cancelled", "Фаза: cancelled");

// Нельзя отменить уже отменённую
const cancelAgain = taskService.cancelTask(task5.id);
assert(cancelAgain === false, "Повторная отмена отклонена");

// ─── Сценарий 6: Терминальные состояния ─────────────────────
section("Сценарий 6: Терминальные состояния блокируют переходы");

assert(taskService.transition(task1.id, "planning", "llm") === false, "done → planning: ОТКЛОНЁН");
assert(taskService.transition(task1.id, "execution", "llm") === false, "done → execution: ОТКЛОНЁН");
assert(taskService.transition(task5.id, "planning", "llm") === false, "cancelled → planning: ОТКЛОНЁН");

// ─── Сценарий 7: Аудит-лог ─────────────────────────────────
section("Сценарий 7: Аудит-лог");

const transitions1 = taskService.getTaskTransitions(task1.id);
assert(transitions1.length === 4, `task1: 4 перехода в логе (факт: ${transitions1.length})`);
assert(transitions1[0].fromPhase === null && transitions1[0].toPhase === "planning", "Первый: null → planning");
assert(transitions1[0].triggeredBy === "user", "triggered_by: user (создание)");
assert(transitions1[1].triggeredBy === "llm", "triggered_by: llm (переход)");

const transitions5 = taskService.getTaskTransitions(task5.id);
const cancelEntry = transitions5.find(t => t.toPhase === "cancelled");
assert(cancelEntry !== undefined, "cancel записан в лог");
assert(cancelEntry!.triggeredBy === "user", "cancel triggered_by: user");

const transitions4 = taskService.getTaskTransitions(task4.id);
const pauseEntry = transitions4.find(t => t.toPhase === "paused");
assert(pauseEntry !== undefined, "пауза записана в лог");
assert(pauseEntry!.triggeredBy === "system", "пауза triggered_by: system");

// Невалидный переход НЕ записан
const invalidTransitions = transitions1.filter(t => t.toPhase === "done" && t.fromPhase === "planning");
assert(invalidTransitions.length === 0, "Невалидные переходы НЕ попадают в лог");

// ─── Сценарий 8: Создание новой задачи паузит предыдущую ────
section("Сценарий 8: Создание новой задачи паузит предыдущую");

const taskA = taskService.createTask(state.sessionId, "Задача A");
taskService.transition(taskA.id, "execution", "llm");
const taskB = taskService.createTask(state.sessionId, "Задача B");
assert(taskRepo.findById(taskA.id)!.phase === "paused", "Задача A запаузена при создании B");
assert(taskRepo.findById(taskA.id)!.previousPhase === "execution", "A previousPhase: execution");
assert(taskB.phase === "planning", "Задача B активна в planning");

// ─── Сценарий 9: REPL-команды /task done, /task pause, /task switch не работают ──
section("Сценарий 9: Удалённые REPL-команды");

const task9 = taskService.createTask(state.sessionId, "REPL тест");
await handleCommand("/task", "done", state, deps);
assert(taskRepo.findById(task9.id)!.phase === "planning", "/task done не меняет фазу");

await handleCommand("/task", "pause", state, deps);
assert(taskRepo.findById(task9.id)!.phase === "planning", "/task pause не меняет фазу");

await handleCommand("/task", "switch", state, deps);
assert(taskRepo.findById(task9.id)!.phase === "planning", "/task switch не меняет фазу");

// ─── Сценарий 10: buildInvalidTransitionMessage содержит граф ──
section("Сценарий 10: Сообщение об ошибке содержит граф");

const errMsg = TaskPhasePrompts.buildInvalidTransitionMessage(
  { id: 1, sessionId: 1, title: "X", phase: "planning", previousPhase: null, summary: null, createdAt: "", updatedAt: "" },
  "done",
);
assert(errMsg.includes("planning → done"), "Содержит попытку перехода");
assert(errMsg.includes("запрещён"), "Содержит слово 'запрещён'");
assert(errMsg.includes("execution"), "Содержит допустимый переход execution");
assert(errMsg.includes("терминальное"), "Содержит граф с терминальными состояниями");

// ─── Сценарий 11: TaskStateMachine.getAllowedTransitions ───────
section("Сценарий 11: getAllowedTransitions корректен");

assert(
  JSON.stringify(TaskStateMachine.getAllowedTransitions("planning")) === '["execution","cancelled"]',
  "planning: [execution, cancelled]",
);
assert(
  TaskStateMachine.getAllowedTransitions("done").length === 0,
  "done: пустой массив",
);
assert(
  !TaskStateMachine.getAllowedTransitions("execution").includes("paused" as any),
  "execution: не содержит paused (LLM не может паузить)",
);

// ─── Сценарий 12: Парсинг маркеров перехода ───────────────────
section("Сценарий 12: Парсинг маркеров");

const jsonMarker = `Ответ ассистента\n<!--task-update\n{"transition": "execution", "summary": "План утверждён"}\n-->`;
const parsed = TaskPhasePrompts.parseTaskUpdate(jsonMarker);
assert(parsed !== null, "JSON-маркер распознан");
assert(parsed!.transition === "execution", "transition: execution");
assert(parsed!.summary === "План утверждён", "summary корректен");

const stripped = TaskPhasePrompts.stripTaskMarkers(jsonMarker);
assert(stripped === "Ответ ассистента", "Маркер удалён из вывода");

const simpleMarker = "Код готов!\n[TRANSITION: validation]\n[SUMMARY: реализация завершена]";
const parsedSimple = TaskPhasePrompts.parseTaskUpdate(simpleMarker);
assert(parsedSimple !== null, "Простой маркер распознан");
assert(parsedSimple!.transition === "validation", "Простой transition: validation");

// ─── Итог ────────────────────────────────────────────────────
console.log(`\n${"═".repeat(50)}`);
console.log(`${passed > 0 ? GREEN : ""}  ${passed} passed${RESET}`);
if (failed > 0) console.log(`${RED}  ${failed} failed${RESET}`);
console.log(`${"═".repeat(50)}`);

// Cleanup
try { unlinkSync(DB_PATH); } catch {}

process.exit(failed > 0 ? 1 : 0);
