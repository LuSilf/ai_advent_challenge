/**
 * E2E-тест с живой LLM.
 *
 * Проверяет:
 * 1. LLM генерирует маркеры переходов в ответе
 * 2. Переход planning → execution при подтверждении плана
 * 3. Невалидный переход отклоняется, retry исправляет
 * 4. Полный цикл до done
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
import { SqliteProfileRepository } from "./storage/sqlite/profile-repository";
import { SqliteMemoryRepository } from "./storage/sqlite/memory-repository";
import { SqliteTaskRepository } from "./storage/sqlite/task-repository";
import { SqliteTaskTransitionRepository } from "./storage/sqlite/task-transition-repository";

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

// ─── Helpers ──────────────────────────────────────────────
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

let passed = 0;
let failed = 0;
let totalCost = 0;

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
  console.log(`\n${YELLOW}── ${name} ──${RESET}`);
}

function logResponse(label: string, content: string): void {
  const short = content.length > 200 ? content.slice(0, 200) + "..." : content;
  console.log(`${DIM}  [${label}] ${short.replace(/\n/g, " ")}${RESET}`);
}

// ─── Setup ────────────────────────────────────────────────
const DB_PATH = join(tmpdir(), `e2e-live-${Date.now()}.db`);
try { unlinkSync(DB_PATH); } catch {}

const config = loadConfig([], (msg) => { throw new Error(msg); });
initDb(DB_PATH);

const optionsRepo = new SqliteOptionsRepository();

const openaiClient = new OpenAI({
  apiKey: config.apiKey,
  baseURL: config.baseUrl,
  timeout: config.effectiveTimeoutMs,
  maxRetries: 0,
});

const sessionRepo = new SqliteSessionRepository();
const messageRepo = new SqliteMessageRepository();
const factRepo = new SqliteFactRepository();
const modelRepo = new SqliteModelRepository();
const profileRepo = new SqliteProfileRepository();
const memoryRepo = new SqliteMemoryRepository();
const taskRepo = new SqliteTaskRepository();
const taskTransitionRepo = new SqliteTaskTransitionRepository();

const llmClient = new OpenAILLMClient(openaiClient);
const sessionService = new SessionService(sessionRepo, messageRepo);
const contextService = new ContextService();
const costService = new CostService(modelRepo);
const profileService = new ProfileService(profileRepo, optionsRepo);
const chatService = new ChatService(llmClient, sessionService, contextService, costService, messageRepo, factRepo, modelRepo, profileService);
const taskService = new TaskService(taskRepo, taskTransitionRepo);

const sessionId = sessionService.createSession("E2E Live Test", "full");

async function sendMessage(userPrompt: string, task: any): Promise<{ content: string; update: any }> {
  let systemPrompt = config.systemPrompt || "Ты — полезный ассистент. Отвечай кратко.";

  if (task) {
    const phasePrompt = TaskPhasePrompts.buildPhasePrompt(task);
    if (phasePrompt) {
      systemPrompt = `${phasePrompt}\n\n${systemPrompt}`;
    }
  }

  const taskReminder = task ? TaskPhasePrompts.buildTaskReminder(task) : undefined;

  const result = await chatService.sendMessage(sessionId, userPrompt, {
    historyLimit: 50,
    systemPrompt,
    useStreaming: false,
    temperature: 0.1,
    userPromptSuffix: taskReminder,
  });

  if (result.costInfo) {
    totalCost += result.costInfo.cost;
  }

  const update = TaskPhasePrompts.parseTaskUpdate(result.response.content);
  const clean = TaskPhasePrompts.stripTaskMarkers(result.response.content);

  return { content: clean, update };
}

// ─── Тест 1: Создание задачи, LLM в фазе planning ────────
section("Тест 1: LLM в фазе planning генерирует маркер");

const task = taskService.createTask(sessionId, "Написать функцию сложения двух чисел");
assert(task.phase === "planning", "Задача создана в planning");

const r1 = await sendMessage("Напиши функцию сложения двух чисел на TypeScript", task);
logResponse("planning", r1.content);

assert(r1.update !== null, "LLM вернул маркер task-update");
if (r1.update) {
  assert(r1.update.summary !== null, "LLM вернул summary");
  console.log(`${DIM}  summary: ${r1.update.summary}${RESET}`);
  console.log(`${DIM}  transition: ${r1.update.transition}${RESET}`);
}

// ─── Тест 2: Подтверждение плана → переход в execution ────
section("Тест 2: Подтверждение плана → execution");

const r2 = await sendMessage("Да, план отличный, давай реализуй", task);
logResponse("→ execution?", r2.content);

assert(r2.update !== null, "LLM вернул маркер");
if (r2.update?.transition) {
  const ok = taskService.transition(task.id, r2.update.transition, "llm");
  if (ok) {
    console.log(`${GREEN}  Переход: ${task.phase} → ${r2.update.transition}${RESET}`);
  } else {
    console.log(`${RED}  Переход отклонён: ${task.phase} → ${r2.update.transition}${RESET}`);
  }
  if (r2.update.summary) taskService.updateSummary(task.id, r2.update.summary);
}

const taskAfter2 = taskRepo.findById(task.id)!;
assert(taskAfter2.phase === "execution", `Фаза теперь execution (факт: ${taskAfter2.phase})`);

// ─── Тест 3: В execution LLM пишет код ───────────────────
section("Тест 3: В execution LLM пишет код");

const r3 = await sendMessage("Давай, пиши код", taskAfter2);
logResponse("execution", r3.content);

assert(r3.update !== null, "LLM вернул маркер из execution");
if (r3.update?.transition) {
  const ok = taskService.transition(task.id, r3.update.transition, "llm");
  if (ok) {
    console.log(`${GREEN}  Переход: execution → ${r3.update.transition}${RESET}`);
  }
  if (r3.update.summary) taskService.updateSummary(task.id, r3.update.summary);
}

const taskAfter3 = taskRepo.findById(task.id)!;
console.log(`${DIM}  Фаза после execution: ${taskAfter3.phase}${RESET}`);

// ─── Тест 4: Дойдём до done ──────────────────────────────
section("Тест 4: Дойдём до done");

let currentTask = taskRepo.findById(task.id)!;
let attempts = 0;
const MAX_ATTEMPTS = 6;

while (currentTask.phase !== "done" && attempts < MAX_ATTEMPTS) {
  attempts++;
  let prompt: string;

  if (currentTask.phase === "planning") {
    prompt = "Да, утверждаю план. Давай.";
  } else if (currentTask.phase === "execution") {
    prompt = "Код готов, переходи к проверке.";
  } else if (currentTask.phase === "validation") {
    prompt = "Всё верно, подтверждаю. Готово.";
  } else {
    break;
  }

  const r = await sendMessage(prompt, currentTask);
  logResponse(`attempt ${attempts} (${currentTask.phase})`, r.content);

  if (r.update?.transition && r.update.transition !== currentTask.phase) {
    const ok = taskService.transition(task.id, r.update.transition, "llm");
    if (ok) {
      console.log(`${GREEN}  Переход: ${currentTask.phase} → ${r.update.transition}${RESET}`);
    } else {
      console.log(`${RED}  Невалидный переход: ${currentTask.phase} → ${r.update.transition}${RESET}`);
    }
  }
  if (r.update?.summary) taskService.updateSummary(task.id, r.update.summary);

  currentTask = taskRepo.findById(task.id)!;
}

assert(currentTask.phase === "done", `Задача завершена (факт: ${currentTask.phase})`);

// ─── Тест 5: Аудит-лог полного цикла ─────────────────────
section("Тест 5: Аудит-лог полного цикла");

const transitions = taskService.getTaskTransitions(task.id);
console.log(`${DIM}  Всего переходов: ${transitions.length}${RESET}`);
for (const t of transitions) {
  console.log(`${DIM}    ${t.fromPhase ?? "—"} → ${t.toPhase} (${t.triggeredBy})${RESET}`);
}

assert(transitions.length >= 4, `Минимум 4 перехода (факт: ${transitions.length})`);
assert(transitions[0].fromPhase === null && transitions[0].toPhase === "planning", "Первый: null → planning");
const doneTransition = transitions.find(t => t.toPhase === "done");
assert(doneTransition !== undefined, "Есть переход в done");
assert(doneTransition?.triggeredBy === "llm", "done triggered_by: llm");

// ─── Тест 6: Терминальное состояние после done ────────────
section("Тест 6: Из done нельзя выйти");

const noGo = taskService.transition(task.id, "planning", "llm");
assert(noGo === false, "done → planning: ОТКЛОНЁН");

// ─── Итог ────────────────────────────────────────────────────
console.log(`\n${"═".repeat(50)}`);
console.log(`${passed > 0 ? GREEN : ""}  ${passed} passed${RESET}`);
if (failed > 0) console.log(`${RED}  ${failed} failed${RESET}`);
console.log(`${DIM}  Стоимость: $${totalCost.toFixed(6)}${RESET}`);
console.log(`${"═".repeat(50)}`);

try { unlinkSync(DB_PATH); } catch {}
process.exit(failed > 0 ? 1 : 0);
