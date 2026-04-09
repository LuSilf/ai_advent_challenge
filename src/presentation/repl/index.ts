import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { writeFileSync, readFileSync, unlinkSync, mkdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import pc from "picocolors";
import type OpenAI from "openai";
import type { Response } from "openai/resources/responses/responses";

import type { AppConfig } from "../../config";
import { applyDbOptions } from "../../config";
import { printOutputMarker, printRequestDebug, printResponseDebug, type DebugContext } from "../../debug-logger";

import type { SessionService } from "../../domain/services/session-service";
import type { ChatService } from "../../domain/services/chat-service";
import type { MemoryService } from "../../domain/services/memory-service";
import type { ContextService } from "../../domain/services/context-service";
import type { CostService } from "../../domain/services/cost-service";
import type { ModelRepository } from "../../domain/ports/model-repository";
import type { OptionsRepository } from "../../domain/ports/options-repository";
import type { CheckpointRepository } from "../../domain/ports/checkpoint-repository";
import type { FactRepository } from "../../domain/ports/fact-repository";
import type { LLMClient } from "../../domain/ports/llm-client";
import type { ProfileService } from "../../domain/services/profile-service";
import type { TaskService } from "../../domain/services/task-service";
import type { McpServerRepository } from "../../domain/ports/mcp-server-repository";
import type { SchedulerRepository } from "../../domain/ports/scheduler-repository";
import { McpClientService } from "../../domain/services/mcp-client-service";
import type { McpConnectionManager } from "../../domain/services/mcp-connection-manager";
import { SchedulerService } from "../../domain/services/scheduler-service";
import { TaskPhasePrompts } from "../../domain/services/task-phase-prompts";
import { formatToolCallStart, formatToolCallResult } from "./tool-use-formatter";
import type { ToolProvider } from "../../domain/services/chat-service";
import { TaskStateMachine } from "../../domain/services/task-state-machine";

export type ReplDeps = {
  config: AppConfig;
  sessionService: SessionService;
  chatService: ChatService;
  memoryService: MemoryService;
  contextService: ContextService;
  costService: CostService;
  modelRepo: ModelRepository;
  optionsRepo: OptionsRepository;
  checkpointRepo: CheckpointRepository;
  factRepo: FactRepository;
  llmClient: LLMClient;
  openaiClient: OpenAI;
  profileService: ProfileService;
  taskService: TaskService;
  mcpServerRepo: McpServerRepository;
  mcpConnectionManager: McpConnectionManager;
  schedulerRepo: SchedulerRepository;
  schedulerService?: SchedulerService;
};

function buildToolProvider(manager: McpConnectionManager): ToolProvider | undefined {
  const tools = manager.getAvailableTools();
  if (tools.length === 0) return undefined;

  return {
    getToolDefinitions: () =>
      tools.map((t) => ({
        name: `${t.serverName}__${t.name}`,
        description: t.description,
        parameters: t.inputSchema,
      })),
    callTool: async (name, args) => {
      const sep = name.indexOf("__");
      const serverName = sep >= 0 ? name.slice(0, sep) : "";
      const toolName = sep >= 0 ? name.slice(sep + 2) : name;
      return manager.callTool(serverName, toolName, args);
    },
  };
}

function printSessionInfo(sessionId: number, title: string | null, messageCount: number): void {
  const name = title ? `"${title}"` : "(без названия)";
  console.log(pc.cyan(`Сессия #${sessionId}: ${name} (${messageCount} сообщений)`));
}

type ChatMessage = { role: string; content: string };

function printSessionMessages(messages: ChatMessage[]): void {
  if (messages.length === 0) return;
  console.log(pc.dim("История сообщений:"));
  for (const msg of messages) {
    const prefix = msg.role === "user" ? pc.green("Вы: ") : pc.blue("Бот: ");
    console.log(prefix + msg.content.replace(/\n/g, "\n    "));
    console.log();
  }
}

function showSessionTasks(taskService: import("../../domain/services/task-service").TaskService, sessionId: number): void {
  const tasks = taskService.getSessionTasks(sessionId);
  if (tasks.length === 0) return;

  const active = tasks.find((t) => !["paused", "done", "cancelled"].includes(t.phase));
  const paused = tasks.filter((t) => t.phase === "paused");

  if (active) {
    console.log(pc.cyan(`\nАктивная задача #${active.id}: "${active.title}" [${active.phase}]`));
    if (active.summary) console.log(pc.dim(`  ${active.summary}`));
  } else if (paused.length === 1) {
    // Единственная paused задача — авто-resume
    const task = paused[0];
    taskService.resumeTask(task.id);
    console.log(pc.cyan(`\nВосстановлена задача #${task.id}: "${task.title}" [${task.previousPhase ?? task.phase}]`));
    if (task.summary) console.log(pc.dim(`  ${task.summary}`));
  } else if (paused.length > 1) {
    console.log(pc.yellow("\nПриостановленные задачи:"));
    for (const t of paused) {
      console.log(`  #${t.id} "${t.title}" [${pc.dim(t.previousPhase ?? "paused")}]`);
      if (t.summary) console.log(pc.dim(`      ${t.summary}`));
    }
    console.log(pc.dim("  Используйте /task switch для переключения"));
  }
}

function printHelp(): void {
  console.log(pc.bold("Команды:"));
  console.log("  /new              Создать новую сессию");
  console.log("  /list             Список сессий");
  console.log("  /switch N         Переключиться на сессию N");
  console.log("  /clear            Очистить сообщения текущей сессии");
  console.log("  /delete N         Удалить сессию N");
  console.log("  /rename текст     Переименовать текущую сессию");
  console.log("  /history          Показать историю текущей сессии");
  console.log("  /edit             Открыть $EDITOR для ввода промпта");
  console.log(pc.bold("Память:"));
  console.log("  /remember <текст> Сохранить в долговременную память (глобальная)");
  console.log("  /save_facts <текст> Сохранить в рабочую память (проект)");
  console.log("  /memory           Показать долговременную память");
  console.log("  /facts            Показать рабочую память проекта");
  console.log("  /edit_memory      Редактировать долговременную память ($EDITOR)");
  console.log("  /edit_facts       Редактировать рабочую память ($EDITOR)");
  console.log(pc.bold("Стратегии контекста:"));
  console.log("  /strategy [name]  Показать/сменить стратегию (full|sliding)");
  console.log(pc.bold("Модели:"));
  console.log("  /models           Список доступных моделей с ценами");
  console.log("  /roles            Текущий маппинг ролей на модели");
  console.log("  /set_model <роль> <model_id>  Назначить модель на роль");
  console.log(pc.bold("Ветвление:"));
  console.log("  /checkpoint       Создать точку ветвления");
  console.log("  /branch [name]    Создать ветку от checkpoint");
  console.log("  /branches         Список веток");
  console.log("  /switch-branch N  Переключиться на ветку N");
  console.log();
  console.log(pc.bold("Профиль:"));
  console.log("  /profile              Показать активный профиль");
  console.log("  /profile create <имя> Создать профиль");
  console.log("  /profile list         Список профилей");
  console.log("  /profile switch <id>  Переключить активный профиль");
  console.log("  /profile edit         Редактировать профиль в $EDITOR (YAML)");
  console.log("  /profile delete <id>  Удалить профиль");
  console.log(pc.bold("Задачи:"));
  console.log("  /task              Показать текущую задачу и историю переходов");
  console.log('  /task create <имя> Создать задачу');
  console.log("  /task list         Список задач в сессии");
  console.log("  /task cancel       Отменить текущую задачу");
  console.log(pc.bold("MCP:"));
  console.log("  /mcp add <n> <cmd> Зарегистрировать MCP-сервер");
  console.log("  /mcp list          Список MCP-серверов");
  console.log("  /mcp tools <name>  Показать инструменты сервера");
  console.log("  /mcp remove <name> Удалить MCP-сервер");
  console.log(pc.bold("Планировщик:"));
  console.log('  /schedule create <cron> <prompt>  Создать задачу');
  console.log("  /schedule list                    Список задач");
  console.log("  /schedule delete <id>             Удалить задачу");
  console.log("  /schedule results [id]            История выполнений");
  console.log("  /schedule enable <id>             Включить задачу");
  console.log("  /schedule disable <id>            Выключить задачу");
  console.log(pc.bold("Настройки:"));
  console.log("  /options          Показать все настройки");
  console.log("  /set <ключ> <зн>  Установить значение настройки");
  console.log();
  console.log("  /help             Показать эту справку");
  console.log("  /exit             Выход (или Ctrl+D)");
  console.log(pc.dim("Введите сообщение и нажмите Enter дважды для отправки."));
}

function startSpinner(message: string): () => void {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  process.stdout.write(pc.dim(`${frames[0]} ${message}`));
  const interval = setInterval(() => {
    i = (i + 1) % frames.length;
    process.stdout.write(`\r${pc.dim(`${frames[i]} ${message}`)}`);
  }, 80);
  return () => {
    clearInterval(interval);
    process.stdout.write(`\r${" ".repeat(message.length + 4)}\r`);
  };
}

async function askUserChoice(rl: ReturnType<typeof createInterface>, prompt: string): Promise<string> {
  process.stdout.write(prompt);
  return new Promise((resolve) => {
    const onLine = (line: string) => {
      rl.removeListener("line", onLine);
      resolve(line.trim().toLowerCase());
    };
    rl.on("line", onLine);
  });
}

async function askUserInput(rl: ReturnType<typeof createInterface>, prompt: string): Promise<string> {
  process.stdout.write(prompt);
  return new Promise((resolve) => {
    const onLine = (line: string) => {
      rl.removeListener("line", onLine);
      resolve(line.trim());
    };
    rl.on("line", onLine);
  });
}

function profileToYaml(profile: { name: string; userName?: string | null; language?: string | null; style?: string | null; format?: string | null; restrictions?: string | null }, preferences: { key: string; value: string }[] = []): string {
  const lines = [
    `name: ${profile.name}`,
    `user_name: ${profile.userName || ""}`,
    `language: ${profile.language || ""}`,
    `style: ${profile.style || ""}`,
    `format: ${profile.format || ""}`,
    `restrictions: ${profile.restrictions || ""}`,
    "",
    "# Произвольные предпочтения (ключ: значение)",
    "preferences:",
  ];
  if (preferences.length > 0) {
    for (const p of preferences) {
      lines.push(`  ${p.key}: ${p.value}`);
    }
  } else {
    lines.push("  # example_key: example_value");
  }
  return lines.join("\n");
}

function yamlToProfile(yaml: string): { fields: Record<string, string>; preferences: { key: string; value: string }[] } {
  const fields: Record<string, string> = {};
  const preferences: { key: string; value: string }[] = [];
  let inPreferences = false;

  for (const line of yaml.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (trimmed === "preferences:") {
      inPreferences = true;
      continue;
    }

    const match = trimmed.match(/^(\w+):\s*(.*)/);
    if (!match) continue;

    const [, key, value] = match;
    if (inPreferences) {
      if (value) preferences.push({ key, value });
    } else {
      fields[key] = value;
    }
  }

  return { fields, preferences };
}

async function askUserEdit(rl: ReturnType<typeof createInterface>, text: string): Promise<string> {
  const editor = process.env.EDITOR || "vi";
  const tmpFile = join(tmpdir(), `memory-edit-${Date.now()}.md`);
  writeFileSync(tmpFile, text);
  const result = spawnSync(editor, [tmpFile], { stdio: "inherit" });
  if (result.status !== 0) return text;
  try {
    const content = readFileSync(tmpFile, "utf-8").trim();
    unlinkSync(tmpFile);
    return content || text;
  } catch {
    return text;
  }
}

export async function handleCommand(
  cmd: string,
  args: string,
  state: { sessionId: number; messagesSinceReconciliation: number },
  deps: ReplDeps,
  rl?: ReturnType<typeof createInterface>,
): Promise<string | null> {
  const { config, sessionService, memoryService, contextService, costService, modelRepo, optionsRepo, checkpointRepo, taskService } = deps;

  switch (cmd) {
    case "/new": {
      state.sessionId = sessionService.createSession(undefined, config.contextStrategy);
      state.messagesSinceReconciliation = 0;
      console.log(pc.green(`Создана новая сессия #${state.sessionId} (стратегия: ${config.contextStrategy})`));
      return null;
    }
    case "/list": {
      const sessions = sessionService.listSessions();
      if (sessions.length === 0) {
        console.log(pc.dim("Нет сессий"));
        return null;
      }
      for (const s of sessions) {
        const marker = s.id === state.sessionId ? pc.yellow(" ←") : "";
        const name = s.title ? `"${s.title}"` : "(без названия)";
        console.log(`  #${s.id} ${name} — ${s.messageCount} сообщений, ${s.updatedAt}${marker}`);
      }
      return null;
    }
    case "/switch": {
      const id = Number(args);
      if (!Number.isInteger(id) || id < 1) {
        console.log(pc.red("Укажите номер сессии: /switch N"));
        return null;
      }
      const session = sessionService.getSession(id);
      if (!session) {
        console.log(pc.red(`Сессия #${id} не найдена`));
        return null;
      }
      // Автопауза задач в покидаемой сессии
      taskService.pauseAllActive(state.sessionId);
      state.sessionId = id;
      state.messagesSinceReconciliation = 0;
      const count = sessionService.getMessageCount(id);
      printSessionInfo(id, session.title, count);
      const msgs = sessionService.getHistory(id, config.historyLimit).map((m) => ({
        role: m.role,
        content: m.content,
      }));
      printSessionMessages(msgs);
      // Показ задач при входе в сессию
      showSessionTasks(taskService, id);
      return null;
    }
    case "/clear": {
      sessionService.clearMessages(state.sessionId);
      console.log(pc.green(`Сообщения сессии #${state.sessionId} очищены`));
      return null;
    }
    case "/delete": {
      const id = Number(args);
      if (!Number.isInteger(id) || id < 1) {
        console.log(pc.red("Укажите номер сессии: /delete N"));
        return null;
      }
      if (sessionService.deleteSession(id)) {
        console.log(pc.green(`Сессия #${id} удалена`));
        if (id === state.sessionId) {
          state.sessionId = sessionService.createSession(undefined, config.contextStrategy);
          console.log(pc.green(`Создана новая сессия #${state.sessionId}`));
        }
      } else {
        console.log(pc.red(`Сессия #${id} не найдена`));
      }
      return null;
    }
    case "/rename": {
      if (!args.trim()) {
        console.log(pc.red("Укажите название: /rename текст"));
        return null;
      }
      sessionService.renameSession(state.sessionId, args.trim());
      console.log(pc.green(`Сессия #${state.sessionId} переименована: "${args.trim()}"`));
      return null;
    }
    case "/history": {
      const msgs = sessionService.getHistory(state.sessionId);
      if (msgs.length === 0) {
        console.log(pc.dim("История пуста"));
        return null;
      }
      for (const m of msgs) {
        const prefix = m.role === "user" ? pc.green("Вы: ") : pc.blue("Бот: ");
        console.log(prefix + m.content.replace(/\n/g, "\n    "));
        console.log();
      }
      return null;
    }
    case "/edit": {
      const editor = process.env.EDITOR || "vi";
      const tmpFile = join(tmpdir(), `chat-prompt-${Date.now()}.txt`);
      writeFileSync(tmpFile, "");
      const result = spawnSync(editor, [tmpFile], { stdio: "inherit" });
      if (result.status !== 0) {
        console.log(pc.red("Редактор завершился с ошибкой"));
        return null;
      }
      try {
        const content = readFileSync(tmpFile, "utf-8").trim();
        unlinkSync(tmpFile);
        if (!content) {
          console.log(pc.dim("Пустой ввод, сообщение не отправлено"));
          return null;
        }
        return content;
      } catch {
        return null;
      }
    }
    case "/strategy": {
      if (!args.trim()) {
        const current = sessionService.getStrategy(state.sessionId);
        console.log(pc.cyan(`Текущая стратегия: ${current}`));
        console.log(pc.dim("Доступные: full, sliding"));
        return null;
      }
      const name = args.trim().toLowerCase();
      if (!contextService.isValidStrategy(name)) {
        console.log(pc.red(`Неизвестная стратегия: ${name}. Доступные: full, sliding`));
        return null;
      }
      sessionService.setStrategy(state.sessionId, name);
      console.log(pc.green(`Стратегия сменена на: ${name}`));
      return null;
    }
    case "/facts": {
      const content = memoryService.readMemory("working");
      if (!content) {
        console.log(pc.dim("Рабочая память пуста"));
        return null;
      }
      console.log(pc.bold("Рабочая память проекта:"));
      console.log(content);
      return null;
    }
    case "/memory": {
      const content = memoryService.readMemory("longterm");
      if (!content) {
        console.log(pc.dim("Долговременная память пуста"));
        return null;
      }
      console.log(pc.bold("Долговременная память:"));
      console.log(content);
      return null;
    }
    case "/edit_memory": {
      const currentContent = memoryService.readMemory("longterm");
      if (rl) {
        const edited = await askUserEdit(rl, currentContent);
        if (edited !== currentContent) {
          memoryService.writeMemory("longterm", edited);
          console.log(pc.green("Долговременная память обновлена"));
        } else {
          console.log(pc.dim("Без изменений"));
        }
      }
      return null;
    }
    case "/edit_facts": {
      const currentContent = memoryService.readMemory("working");
      if (rl) {
        const edited = await askUserEdit(rl, currentContent);
        if (edited !== currentContent) {
          memoryService.writeMemory("working", edited);
          console.log(pc.green("Рабочая память обновлена"));
        } else {
          console.log(pc.dim("Без изменений"));
        }
      }
      return null;
    }
    case "/checkpoint": {
      try {
        const msgId = checkpointRepo.create(state.sessionId);
        console.log(pc.green(`Checkpoint создан (сообщение #${msgId})`));
      } catch (e) {
        console.log(pc.red(e instanceof Error ? e.message : String(e)));
      }
      return null;
    }
    case "/branch": {
      const checkpoint = checkpointRepo.getLastBySession(state.sessionId);
      if (!checkpoint) {
        console.log(pc.red("Нет checkpoint. Сначала используйте /checkpoint"));
        return null;
      }
      const branchTitle = args.trim() || undefined;
      const newId = sessionService.createBranch(state.sessionId, checkpoint.messageId, branchTitle);
      state.sessionId = newId;
      const count = sessionService.getMessageCount(newId);
      const strategy = sessionService.getStrategy(newId);
      console.log(pc.green(`Создана ветка #${newId} (${count} сообщений, стратегия: ${strategy})`));
      return null;
    }
    case "/branches": {
      const branches = sessionService.getBranches(state.sessionId);
      if (branches.length === 0) {
        console.log(pc.dim("Нет веток"));
        return null;
      }
      console.log(pc.bold("Ветки:"));
      for (let i = 0; i < branches.length; i++) {
        const b = branches[i];
        const marker = b.id === state.sessionId ? pc.yellow(" ←") : "";
        const name = b.title ? `"${b.title}"` : "(без названия)";
        const strategy = sessionService.getStrategy(b.id);
        console.log(`  ${i + 1}. #${b.id} ${name} — ${b.messageCount} сообщ., стратегия: ${strategy}${marker}`);
      }
      return null;
    }
    case "/switch-branch": {
      const branches = sessionService.getBranches(state.sessionId);
      const idx = Number(args) - 1;
      if (!Number.isInteger(idx) || idx < 0 || idx >= branches.length) {
        console.log(pc.red(`Укажите номер ветки (1-${branches.length}): /switch-branch N`));
        return null;
      }
      const branch = branches[idx];
      state.sessionId = branch.id;
      const count = sessionService.getMessageCount(branch.id);
      const strategy = sessionService.getStrategy(branch.id);
      printSessionInfo(branch.id, branch.title, count);
      console.log(pc.dim(`Стратегия: ${strategy}`));
      return null;
    }
    case "/models": {
      const models = modelRepo.getAll();
      if (models.length === 0) {
        console.log(pc.dim("Нет моделей"));
        return null;
      }
      const rows = models.map((m) => ({
        id: m.id,
        name: m.name,
        input: `$${m.inputPrice}`,
        output: `$${m.outputPrice}`,
        ctx: m.contextSize >= 1_000_000
          ? `${(m.contextSize / 1_000_000).toFixed(1)}M`
          : `${(m.contextSize / 1_000).toFixed(0)}K`,
      }));
      const col = {
        id: Math.max(2, ...rows.map((r) => r.id.length)),
        name: Math.max(4, ...rows.map((r) => r.name.length)),
        input: Math.max(6, ...rows.map((r) => r.input.length)),
        output: Math.max(7, ...rows.map((r) => r.output.length)),
        ctx: Math.max(3, ...rows.map((r) => r.ctx.length)),
      };
      const header = `  ${"ID".padEnd(col.id)}  ${"Имя".padEnd(col.name)}  ${"In/1M".padStart(col.input)}  ${"Out/1M".padStart(col.output)}  ${"Ctx".padStart(col.ctx)}`;
      const sep = `  ${"─".repeat(col.id)}  ${"─".repeat(col.name)}  ${"─".repeat(col.input)}  ${"─".repeat(col.output)}  ${"─".repeat(col.ctx)}`;
      console.log(pc.bold(header));
      console.log(pc.dim(sep));
      for (const r of rows) {
        console.log(`  ${pc.cyan(r.id.padEnd(col.id))}  ${r.name.padEnd(col.name)}  ${r.input.padStart(col.input)}  ${r.output.padStart(col.output)}  ${r.ctx.padStart(col.ctx)}`);
      }
      return null;
    }
    case "/roles": {
      const roles = modelRepo.getRoles();
      if (roles.length === 0) {
        console.log(pc.dim("Нет назначенных ролей"));
        return null;
      }
      console.log(pc.bold("Роли:"));
      for (const r of roles) {
        console.log(`  ${pc.cyan(r.role.padEnd(8))} → ${r.modelId} (${r.modelName})`);
      }
      return null;
    }
    case "/set_model": {
      const parts = args.trim().split(/\s+/);
      if (parts.length < 2) {
        console.log(pc.red("Использование: /set_model <роль> <model_id>"));
        console.log(pc.dim("Пример: /set_model chat deepseek/deepseek-v3.2"));
        return null;
      }
      const [role, modelId] = parts;
      const validRoles = ["chat", "title", "facts"];
      if (!validRoles.includes(role)) {
        console.log(pc.red(`Неизвестная роль: ${role}. Доступные: ${validRoles.join(", ")}`));
        return null;
      }
      try {
        modelRepo.setRole(role, modelId);
        console.log(pc.green(`Роль "${role}" → ${modelId}`));
      } catch (e) {
        console.log(pc.red(e instanceof Error ? e.message : String(e)));
      }
      return null;
    }
    case "/remember": {
      const text = args.trim();
      if (!text) {
        console.log(pc.red("Использование: /remember <текст>"));
        return null;
      }

      if (!rl) {
        memoryService.appendMemory("longterm", text);
        console.log(pc.green("Сохранено в долговременную память"));
        return null;
      }

      const factsModel = memoryService.getFactsModel();
      try {
        const stopSpinner = startSpinner("Анализ долговременной памяти...");
        const result = await memoryService.reconcile("longterm", text);
        stopSpinner();

        if (!result.changesSummary || !result.updatedMemory) {
          console.log(pc.dim("Изменений не обнаружено"));
          if (factsModel) {
            console.log(pc.dim(costService.formatMemoryCost(result.inputTokens, result.outputTokens, factsModel, "Без изменений")));
          }
          return null;
        }

        console.log(pc.yellow("Изменения в долговременной памяти:"));
        console.log(pc.dim(result.changesSummary));
        const answer = await askUserChoice(rl, pc.yellow("[д]а / [н]ет / [и]зменить: "));

        if (answer === "д" || answer === "да" || answer === "y" || answer === "yes") {
          memoryService.writeMemory("longterm", result.updatedMemory);
          console.log(pc.green("Долговременная память обновлена"));
          if (factsModel) {
            console.log(pc.dim(costService.formatMemoryCost(result.inputTokens, result.outputTokens, factsModel, "Сохранено в долговременную память")));
          }
        } else if (answer === "и" || answer === "изменить" || answer === "e" || answer === "edit") {
          const edited = await askUserEdit(rl, result.updatedMemory);
          if (edited) {
            memoryService.writeMemory("longterm", edited);
            console.log(pc.green("Долговременная память обновлена (отредактировано)"));
            if (factsModel) {
              console.log(pc.dim(costService.formatMemoryCost(result.inputTokens, result.outputTokens, factsModel, "Сохранено в долговременную память")));
            }
          }
        } else {
          console.log(pc.dim("Изменения отклонены"));
          if (factsModel) {
            console.log(pc.dim(costService.formatMemoryCost(result.inputTokens, result.outputTokens, factsModel, "Изменения отклонены")));
          }
        }
      } catch (e) {
        if (config.debug) {
          console.error(pc.dim(`[Memory] Ошибка: ${e instanceof Error ? e.message : String(e)}`));
        }
        memoryService.appendMemory("longterm", text);
        console.log(pc.green("Сохранено в долговременную память (без реконсиляции)"));
      }
      return null;
    }
    case "/save_facts": {
      const text = args.trim();
      if (!text) {
        console.log(pc.red("Использование: /save_facts <текст>"));
        return null;
      }
      memoryService.appendMemory("working", text);
      console.log(pc.green("Сохранено в рабочую память"));
      return null;
    }
    case "/profile": {
      const { profileService } = deps;
      const subArgs = args.trim();

      if (!subArgs) {
        // Показать активный профиль
        const active = profileService.getActiveProfile();
        if (!active) {
          console.log(pc.dim("Нет активного профиля"));
        } else {
          console.log(pc.bold(`Профиль #${active.id}: "${active.name}"`));
          console.log(profileService.buildProfileBlock(active));
        }
        return null;
      }

      const parts = subArgs.split(/\s+/);
      const subCmd = parts[0];
      const subCmdArgs = parts.slice(1).join(" ");

      switch (subCmd) {
        case "create": {
          let name = subCmdArgs.trim();
          if (!name) {
            if (!rl) {
              console.log(pc.red("Использование: /profile create <имя>"));
              return null;
            }
            name = await askUserInput(rl, pc.cyan("Имя профиля: "));
            if (!name) {
              console.log(pc.red("Имя профиля обязательно"));
              return null;
            }
          }

          let userName: string | undefined;
          let language: string | undefined;
          let style: string | undefined;
          let format: string | undefined;
          let restrictions: string | undefined;

          if (rl) {
            console.log(pc.dim("Заполните поля профиля (Enter — пропустить):"));
            userName = await askUserInput(rl, pc.cyan("  Имя пользователя: ")) || undefined;
            language = await askUserInput(rl, pc.cyan("  Язык ответов: ")) || undefined;
            style = await askUserInput(rl, pc.cyan("  Стиль (формальный/неформальный/технический): ")) || undefined;
            format = await askUserInput(rl, pc.cyan("  Формат (краткий/развёрнутый/с примерами): ")) || undefined;
            restrictions = await askUserInput(rl, pc.cyan("  Ограничения: ")) || undefined;
          }

          const id = profileService.createProfile(name, { userName, language, style, format, restrictions });
          profileService.setActiveProfile(id);
          console.log(pc.green(`Создан и активирован профиль #${id}: "${name}"`));
          return null;
        }
        case "list": {
          const profiles = profileService.getAllProfiles();
          if (profiles.length === 0) {
            console.log(pc.dim("Нет профилей"));
            return null;
          }
          const active = profileService.getActiveProfile();
          for (const p of profiles) {
            const marker = active && p.id === active.id ? pc.yellow(" ←") : "";
            const details = [p.userName, p.language, p.style].filter(Boolean).join(", ");
            console.log(`  #${p.id} "${p.name}"${details ? ` (${details})` : ""}${marker}`);
          }
          return null;
        }
        case "switch": {
          const id = Number(subCmdArgs);
          if (!Number.isInteger(id) || id < 1) {
            console.log(pc.red("Использование: /profile switch <id>"));
            return null;
          }
          const profile = profileService.getProfile(id);
          if (!profile) {
            console.log(pc.red(`Профиль #${id} не найден`));
            return null;
          }
          profileService.setActiveProfile(id);
          console.log(pc.green(`Активный профиль: #${id} "${profile.name}"`));
          return null;
        }
        case "edit": {
          const active = profileService.getActiveProfile();
          if (!active) {
            console.log(pc.red("Нет активного профиля. Создайте: /profile create <имя>"));
            return null;
          }
          if (!rl) return null;

          const prefs = profileService.getPreferences(active.id);
          const yaml = profileToYaml(active, prefs);
          const edited = await askUserEdit(rl, yaml);

          if (edited === yaml) {
            console.log(pc.dim("Без изменений"));
            return null;
          }

          const { fields, preferences } = yamlToProfile(edited);

          const standardFields: Record<string, string> = {
            name: "name", user_name: "userName", language: "language",
            style: "style", format: "format", restrictions: "restrictions",
          };

          const updateFields: Record<string, string | null> = {};
          for (const [yamlKey, domainKey] of Object.entries(standardFields)) {
            if (yamlKey in fields) {
              updateFields[domainKey] = fields[yamlKey] || null;
            }
          }
          if (Object.keys(updateFields).length > 0) {
            profileService.updateProfile(active.id, updateFields as any);
          }

          profileService.replacePreferences(active.id, preferences);

          console.log(pc.green("Профиль обновлён"));
          return null;
        }
        case "delete": {
          const id = Number(subCmdArgs);
          if (!Number.isInteger(id) || id < 1) {
            console.log(pc.red("Использование: /profile delete <id>"));
            return null;
          }
          profileService.deleteProfile(id);
          console.log(pc.green(`Профиль #${id} удалён`));
          return null;
        }
        default: {
          console.log(pc.red(`Неизвестная подкоманда: /profile ${subCmd}`));
          console.log(pc.dim("Доступные: create, list, switch, edit, delete"));
          return null;
        }
      }
    }
    case "/options": {
      const opts = optionsRepo.getAll();
      if (opts.length === 0) {
        console.log(pc.dim("Нет настроек"));
        return null;
      }
      console.log(pc.bold("Настройки:"));
      for (const o of opts) {
        console.log(`  ${pc.cyan(o.key)}: ${o.value}`);
      }
      return null;
    }
    case "/set": {
      const parts = args.trim().split(/\s+/);
      if (parts.length < 2) {
        console.log(pc.red("Использование: /set <ключ> <значение>"));
        return null;
      }
      const [key, ...valueParts] = parts;
      const value = valueParts.join(" ");
      optionsRepo.set(key, value);
      applyDbOptions(config, (k) => optionsRepo.get(k));
      console.log(pc.green(`${key} = ${value}`));
      return null;
    }
    case "/task": {
      const subCmd = args.split(/\s+/)[0] || "";
      const subArgs = args.slice(subCmd.length).trim();

      switch (subCmd) {
        case "create": {
          const title = subArgs.replace(/^["']|["']$/g, "").trim();
          if (!title) {
            console.log(pc.red('Укажите описание: /task create "описание"'));
            return null;
          }
          const task = taskService.createTask(state.sessionId, title);
          console.log(pc.green(`Создана задача #${task.id}: "${task.title}" [${task.phase}]`));
          return null;
        }
        case "list": {
          const tasks = taskService.getSessionTasks(state.sessionId);
          if (tasks.length === 0) {
            console.log(pc.dim("Нет задач в текущей сессии"));
            return null;
          }
          for (const t of tasks) {
            const isActive = !["paused", "done", "cancelled"].includes(t.phase);
            const marker = isActive ? pc.yellow(" ←") : "";
            const phaseColor = t.phase === "done" ? pc.green(t.phase) :
              t.phase === "cancelled" ? pc.red(t.phase) :
              t.phase === "paused" ? pc.dim(t.phase) :
              pc.cyan(t.phase);
            console.log(`  #${t.id} "${t.title}" [${phaseColor}]${marker}`);
            if (t.summary) console.log(pc.dim(`      ${t.summary}`));
          }
          return null;
        }
        case "cancel": {
          const active = taskService.getActiveTask(state.sessionId);
          if (!active) {
            console.log(pc.red("Нет активной задачи для отмены"));
            return null;
          }
          const ok = taskService.cancelTask(active.id);
          if (ok) {
            console.log(pc.red(`Задача #${active.id} "${active.title}" отменена`));
          } else {
            console.log(pc.red("Не удалось отменить задачу"));
          }
          return null;
        }
        default: {
          // /task без аргументов — показать текущую
          const active = taskService.getActiveTask(state.sessionId);
          if (!active) {
            console.log(pc.dim("Нет активной задачи"));
            return null;
          }
          console.log(pc.bold(`Задача #${active.id}: "${active.title}"`));
          console.log(`  Фаза: ${pc.cyan(active.phase)}`);
          if (active.summary) console.log(`  Резюме: ${pc.dim(active.summary)}`);
          const transitions = taskService.getTaskTransitions(active.id);
          if (transitions.length > 0) {
            console.log(pc.dim("  Переходы:"));
            for (const t of transitions) {
              const from = t.fromPhase ?? "—";
              console.log(pc.dim(`    ${from} → ${t.toPhase} (${t.triggeredBy}, ${t.createdAt})`));
            }
          }
          return null;
        }
      }
    }
    case "/schedule": {
      if (!deps.schedulerService) {
        console.log(pc.red("Планировщик не инициализирован"));
        return null;
      }
      const scheduler = deps.schedulerService;
      const [subCmd, ...subArgs] = args.split(/\s+/).filter(Boolean);

      if (!subCmd || subCmd === "help") {
        console.log(pc.bold("Планировщик:"));
        console.log('  /schedule create <cron> <prompt>  Создать задачу по расписанию');
        console.log("  /schedule list                    Список задач");
        console.log("  /schedule delete <id>             Удалить задачу");
        console.log("  /schedule results [id]            История выполнений");
        console.log("  /schedule enable <id>             Включить задачу");
        console.log("  /schedule disable <id>            Выключить задачу");
        return null;
      }

      switch (subCmd) {
        case "create": {
          // /schedule create "*/5 * * * *" мой промпт
          // или /schedule create */5 * * * * мой промпт
          const raw = args.slice("create".length).trim();
          let cronExpr: string;
          let prompt: string;

          if (raw.startsWith('"')) {
            const endQuote = raw.indexOf('"', 1);
            if (endQuote === -1) {
              console.log(pc.red("Незакрытая кавычка в cron-выражении"));
              return null;
            }
            cronExpr = raw.slice(1, endQuote);
            prompt = raw.slice(endQuote + 1).trim();
          } else {
            // Попробуем взять первые 5 токенов как cron
            const tokens = raw.split(/\s+/);
            if (tokens.length < 6) {
              console.log(pc.red('Использование: /schedule create "<cron>" <prompt>'));
              console.log(pc.dim('  Пример: /schedule create "*/30 * * * *" Собери новости'));
              return null;
            }
            cronExpr = tokens.slice(0, 5).join(" ");
            prompt = tokens.slice(5).join(" ");
          }

          if (!prompt) {
            console.log(pc.red("Не указан промпт для задачи"));
            return null;
          }

          if (!scheduler.validateCron(cronExpr)) {
            console.log(pc.red(`Невалидное cron-выражение: "${cronExpr}"`));
            return null;
          }

          const taskName = prompt.slice(0, 50);
          const id = scheduler.createTask(state.sessionId, taskName, cronExpr, prompt);
          const task = scheduler.getTask(id);
          console.log(pc.green(`Задача #${id} создана: "${taskName}"`));
          console.log(pc.dim(`  Cron: ${cronExpr}`));
          if (task?.nextRunAt) {
            console.log(pc.dim(`  Следующий запуск: ${new Date(task.nextRunAt).toLocaleString()}`));
          }
          return null;
        }
        case "list": {
          const tasks = scheduler.getSessionTasks(state.sessionId);
          if (tasks.length === 0) {
            console.log(pc.dim("Нет запланированных задач"));
            return null;
          }
          for (const t of tasks) {
            const status = t.enabled ? pc.green("вкл") : pc.red("выкл");
            const next = t.nextRunAt ? new Date(t.nextRunAt).toLocaleString() : "—";
            console.log(`  ${pc.bold(`#${t.id}`)} [${status}] ${t.name}`);
            console.log(pc.dim(`    Cron: ${t.cronExpression} | Следующий: ${next}`));
          }
          return null;
        }
        case "delete": {
          const id = Number(subArgs[0]);
          if (!id) {
            console.log(pc.red("Использование: /schedule delete <id>"));
            return null;
          }
          const deleted = scheduler.deleteTask(id);
          if (deleted) {
            console.log(pc.green(`Задача #${id} удалена`));
          } else {
            console.log(pc.red(`Задача #${id} не найдена`));
          }
          return null;
        }
        case "enable": {
          const id = Number(subArgs[0]);
          if (!id) {
            console.log(pc.red("Использование: /schedule enable <id>"));
            return null;
          }
          scheduler.enableTask(id);
          console.log(pc.green(`Задача #${id} включена`));
          return null;
        }
        case "disable": {
          const id = Number(subArgs[0]);
          if (!id) {
            console.log(pc.red("Использование: /schedule disable <id>"));
            return null;
          }
          scheduler.disableTask(id);
          console.log(pc.green(`Задача #${id} выключена`));
          return null;
        }
        case "results": {
          const taskId = subArgs[0] ? Number(subArgs[0]) : undefined;
          const executions = taskId
            ? scheduler.getExecutions(taskId)
            : scheduler.getRecentExecutions();

          if (executions.length === 0) {
            console.log(pc.dim("Нет выполнений"));
            return null;
          }

          for (const e of executions) {
            const statusColor = e.status === "success" ? pc.green : pc.red;
            const time = new Date(e.startedAt).toLocaleString();
            console.log(`  ${pc.dim(time)} ${statusColor(e.status)} задача #${e.taskId} (${e.tokensUsed} tokens)`);
            if (e.result) {
              const preview = e.result.length > 200 ? e.result.slice(0, 200) + "..." : e.result;
              console.log(pc.dim(`    ${preview}`));
            }
            if (e.error) {
              console.log(pc.red(`    Ошибка: ${e.error}`));
            }
          }
          return null;
        }
        default: {
          console.log(pc.red(`Неизвестная подкоманда: /schedule ${subCmd}. Введите /schedule help`));
          return null;
        }
      }
    }
    case "/mcp": {
      const { mcpServerRepo } = deps;
      const [subCmd, ...subArgs] = args.split(/\s+/).filter(Boolean);

      if (!subCmd || subCmd === "help") {
        console.log(pc.bold("MCP-команды:"));
        console.log("  /mcp add <name> <command> [args...]  Зарегистрировать MCP-сервер");
        console.log("  /mcp list                            Список серверов");
        console.log("  /mcp tools <name>                    Показать инструменты сервера");
        console.log("  /mcp remove <name>                   Удалить сервер");
        return null;
      }

      switch (subCmd) {
        case "add": {
          if (subArgs.length < 2) {
            console.log(pc.red("Использование: /mcp add <name> <command> [args...]"));
            return null;
          }
          const [name, command, ...cmdArgs] = subArgs;
          const existing = mcpServerRepo.get(name);
          if (existing) {
            console.log(pc.red(`MCP-сервер "${name}" уже зарегистрирован`));
            return null;
          }
          mcpServerRepo.add({ name, command, args: cmdArgs });
          console.log(pc.green(`MCP-сервер "${name}" зарегистрирован: ${command} ${cmdArgs.join(" ")}`.trim()));

          // Автоподключение
          const config = mcpServerRepo.get(name);
          if (config) {
            const stopSpinner = startSpinner(`Подключение к "${name}"...`);
            const [status] = await deps.mcpConnectionManager.connectOne(config);
            stopSpinner();
            if (status.status === "connected") {
              console.log(pc.green(`  ✔ ${name} — ${status.toolCount} инструментов`));
            } else {
              console.log(pc.red(`  ✘ ${name} — ${status.error ?? "ошибка подключения"}`));
            }
          }
          return null;
        }
        case "list": {
          const servers = mcpServerRepo.getAll();
          if (servers.length === 0) {
            console.log(pc.dim("Нет зарегистрированных MCP-серверов"));
            return null;
          }
          for (const s of servers) {
            const argsStr = s.args.length > 0 ? ` ${s.args.join(" ")}` : "";
            console.log(`  ${pc.bold(s.name)}  ${s.command}${argsStr}`);
          }
          return null;
        }
        case "remove": {
          if (!subArgs[0]) {
            console.log(pc.red("Использование: /mcp remove <name>"));
            return null;
          }
          const removed = mcpServerRepo.remove(subArgs[0]);
          if (removed) {
            await deps.mcpConnectionManager.disconnectOne(subArgs[0]);
            console.log(pc.green(`MCP-сервер "${subArgs[0]}" удалён и отключён`));
          } else {
            console.log(pc.red(`MCP-сервер "${subArgs[0]}" не найден`));
          }
          return null;
        }
        case "tools": {
          if (!subArgs[0]) {
            console.log(pc.red("Использование: /mcp tools <name>"));
            return null;
          }
          const serverConfig = mcpServerRepo.get(subArgs[0]);
          if (!serverConfig) {
            console.log(pc.red(`MCP-сервер "${subArgs[0]}" не найден`));
            return null;
          }
          const mcpClient = new McpClientService();
          try {
            const stopSpinner = startSpinner(`Подключение к "${subArgs[0]}"...`);
            const tools = await mcpClient.listTools(serverConfig);
            stopSpinner();
            if (tools.length === 0) {
              console.log(pc.dim("Сервер не предоставляет инструментов"));
            } else {
              console.log(pc.bold(`Инструменты (${tools.length}):`));
              for (const tool of tools) {
                console.log(`  ${pc.green(tool.name)} — ${tool.description}`);
              }
            }
          } catch (error) {
            console.log(pc.red(`Ошибка подключения к "${subArgs[0]}": ${error instanceof Error ? error.message : String(error)}`));
          }
          return null;
        }
        default: {
          console.log(pc.red(`Неизвестная подкоманда: /mcp ${subCmd}. Введите /mcp help`));
          return null;
        }
      }
    }
    case "/help": {
      printHelp();
      return null;
    }
    case "/exit": {
      taskService.pauseAllActive(state.sessionId);
      deps.schedulerService?.stop();
      await deps.mcpConnectionManager.disconnectAll();
      process.exit(0);
    }
    default: {
      console.log(pc.red(`Неизвестная команда: ${cmd}. Введите /help`));
      return null;
    }
  }
}

async function suggestMemorySave(
  deps: ReplDeps,
  rl: ReturnType<typeof createInterface>,
  newContent: string,
): Promise<void> {
  const { memoryService, costService, config } = deps;
  const factsModel = memoryService.getFactsModel();

  try {
    const stopSpinner = startSpinner("Анализ рабочей памяти...");
    const result = await memoryService.reconcile("working", newContent);
    stopSpinner();

    if (!result.changesSummary || !result.updatedMemory) {
      if (factsModel) {
        console.log(pc.dim(costService.formatMemoryCost(result.inputTokens, result.outputTokens, factsModel, "Фактов не обнаружено")));
      }
      return;
    }

    console.log(pc.yellow("\n💡 Изменения в рабочей памяти:"));
    console.log(pc.dim(result.changesSummary));
    const answer = await askUserChoice(rl, pc.yellow("[д]а / [н]ет / [и]зменить: "));

    if (answer === "д" || answer === "да" || answer === "y" || answer === "yes") {
      memoryService.writeMemory("working", result.updatedMemory);
      if (factsModel) {
        console.log(pc.dim(costService.formatMemoryCost(result.inputTokens, result.outputTokens, factsModel, "Сохранено в рабочую память")));
      }
    } else if (answer === "и" || answer === "изменить" || answer === "e" || answer === "edit") {
      const edited = await askUserEdit(rl, result.updatedMemory);
      if (edited) {
        memoryService.writeMemory("working", edited);
        if (factsModel) {
          console.log(pc.dim(costService.formatMemoryCost(result.inputTokens, result.outputTokens, factsModel, "Сохранено в рабочую память")));
        }
      }
    } else {
      if (factsModel) {
        console.log(pc.dim(costService.formatMemoryCost(result.inputTokens, result.outputTokens, factsModel, "Факты отклонены")));
      }
    }
  } catch (e) {
    if (config.debug) {
      console.error(pc.dim(`[Memory] Ошибка реконсиляции: ${e instanceof Error ? e.message : String(e)}`));
    }
    if (factsModel) {
      console.log(pc.dim(costService.formatMemoryCost(0, 0, factsModel, "Ошибка работы с памятью")));
    }
  }
}

async function generateTitle(
  openaiClient: OpenAI,
  modelRepo: ModelRepository,
  userMessage: string,
  assistantMessage: string,
): Promise<string> {
  const titleModel = modelRepo.getRole("title");
  const response = await openaiClient.responses.create({
    model: titleModel?.id ?? "openai/gpt-5-nano",
    instructions: "Придумай короткое название (до 50 символов) для диалога по первому обмену сообщениями. Ответь только названием, без кавычек.",
    input: `Пользователь: ${userMessage}\nАссистент: ${assistantMessage}`,
    stream: false,
  });
  return response.output_text?.trim() || "Без названия";
}

export async function startRepl(deps: ReplDeps): Promise<void> {
  const { config, sessionService, chatService, memoryService, costService, modelRepo, optionsRepo, openaiClient, taskService } = deps;
  const state = { sessionId: 0, messagesSinceReconciliation: 0 };

  const lastSession = sessionService.getLastSession();
  if (lastSession) {
    state.sessionId = lastSession.id;
    const count = sessionService.getMessageCount(lastSession.id);
    printSessionInfo(lastSession.id, lastSession.title, count);
    const msgs = sessionService.getHistory(lastSession.id, config.historyLimit).map((m) => ({
      role: m.role,
      content: m.content,
    }));
    printSessionMessages(msgs);
    showSessionTasks(deps.taskService, lastSession.id);
  } else {
    state.sessionId = sessionService.createSession(undefined, config.contextStrategy);
    console.log(pc.green(`Создана новая сессия #${state.sessionId} (стратегия: ${config.contextStrategy})`));
  }

  console.log(pc.dim("Стратегия: " + sessionService.getStrategy(state.sessionId) + " | /new | /help"));

  // Автоподключение к MCP-серверам
  const mcpConfigs = deps.mcpServerRepo.getAll();
  if (mcpConfigs.length > 0) {
    const statuses = await deps.mcpConnectionManager.connectAll();
    for (const s of statuses) {
      if (s.status === "connected") {
        console.log(pc.green(`  ✔ ${s.serverName} — ${s.toolCount} инструментов`));
      } else {
        console.log(pc.red(`  ✘ ${s.serverName} — ${s.error ?? "ошибка подключения"}`));
      }
    }
  }

  // Инициализация планировщика
  const schedulerService = new SchedulerService({
    schedulerRepo: deps.schedulerRepo,
    chatService,
    getSessionId: () => state.sessionId,
    getSystemPrompt: () => config.systemPrompt,
    getToolProvider: () => buildToolProvider(deps.mcpConnectionManager),
    getMemoryBlocks: () => memoryService.getMemoryBlocks() || undefined,
    getSendOptions: () => ({
      temperature: config.temperature,
      topP: config.topP,
      maxCompletionTokens: config.maxCompletionTokens,
      reasoningEffort: config.reasoningEffort,
      reasoningSummary: config.reasoningSummary,
    }),
    onExecution: (task, execution) => {
      if (execution.status === "success") {
        const preview = execution.result && execution.result.length > 300
          ? execution.result.slice(0, 300) + "..."
          : execution.result;
        console.log(`\n${pc.bgCyan(pc.black(` Задача: ${task.name} `))}`);
        console.log(pc.cyan(preview ?? "(пустой результат)"));
        console.log();
      } else {
        console.log(`\n${pc.bgRed(pc.white(` Задача: ${task.name} — ошибка `))}`);
        console.log(pc.red(execution.error ?? "Неизвестная ошибка"));
        console.log();
      }
      if (!processing) {
        rl.prompt();
      }
    },
  });
  deps.schedulerService = schedulerService;
  schedulerService.start();

  const scheduledCount = schedulerService.getSessionTasks(state.sessionId).filter((t) => t.enabled).length;
  if (scheduledCount > 0) {
    console.log(pc.dim(`Планировщик запущен (${scheduledCount} задач)`));
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: pc.green("> "),
  });

  rl.prompt();

  const inputLines: string[] = [];
  let processing = false;

  const processInput = async (text: string) => {
    processing = true;

    if (text.startsWith("/")) {
      const spaceIdx = text.indexOf(" ");
      const cmd = spaceIdx === -1 ? text : text.slice(0, spaceIdx);
      const cmdArgs = spaceIdx === -1 ? "" : text.slice(spaceIdx + 1);
      const result = await handleCommand(cmd, cmdArgs, state, deps, rl);
      if (result === null) {
        processing = false;
        rl.prompt();
        return;
      }
      text = result;
    }

    try {
      const chatModel = modelRepo.getRole("chat");
      const modelId = chatModel?.id ?? "openai/gpt-5-nano";

      if (config.debug) {
        printRequestDebug(config, modelId, {
          messageCount: sessionService.getMessageCount(state.sessionId),
          longTermMemory: memoryService.readMemory("longterm") || undefined,
          workingMemory: memoryService.readMemory("working") || undefined,
        });
      }

      if (config.debug) {
        printOutputMarker();
      }

      // Формируем системный промпт с фазой задачи
      let systemPrompt = config.systemPrompt;
      const activeTask = taskService.getActiveTask(state.sessionId);
      if (activeTask) {
        const phasePrompt = TaskPhasePrompts.buildPhasePrompt(activeTask);
        if (phasePrompt) {
          systemPrompt = `${phasePrompt}\n\n${systemPrompt}`;
        }
      }

      // Буфер для перехвата маркеров задач при стриминге
      let streamBuffer = "";
      const MARKER_PREFIX = "<!--task-";

      // Напоминание о маркере в user-сообщении (не сохраняется в БД)
      const taskReminder = activeTask
        ? TaskPhasePrompts.buildTaskReminder(activeTask)
        : undefined;

      // Tool provider из подключённых MCP-серверов
      const toolProvider = buildToolProvider(deps.mcpConnectionManager);

      // Добавляем в system prompt описание доступных инструментов
      if (toolProvider) {
        const toolDefs = toolProvider.getToolDefinitions();
        const toolList = toolDefs.map((t) => `  - ${t.name}: ${t.description}`).join("\n");
        systemPrompt = `У тебя есть доступ к внешним инструментам. Если вопрос пользователя можно ответить с помощью инструмента — ОБЯЗАТЕЛЬНО вызови его, не отвечай самостоятельно. Не предлагай создать задачу, если можешь использовать инструмент.

Доступные инструменты:
${toolList}

${systemPrompt}`;
      }

      const stopMainSpinner = startSpinner("Генерация ответа...");
      let mainSpinnerStopped = false;

      const result = await chatService.sendMessage(state.sessionId, text, {
        historyLimit: config.historyLimit,
        systemPrompt,
        useStreaming: config.useStreaming,
        memoryBlocks: memoryService.getMemoryBlocks() || undefined,
        userPromptSuffix: taskReminder,
        temperature: config.temperature,
        topP: config.topP,
        maxCompletionTokens: config.maxCompletionTokens,
        reasoningEffort: config.reasoningEffort,
        reasoningSummary: config.reasoningSummary,
        toolProvider,
        onToolCall: (event) => {
          if (!mainSpinnerStopped) {
            stopMainSpinner();
            mainSpinnerStopped = true;
          }
          if (event.result !== undefined) {
            console.log(formatToolCallResult(event));
          } else {
            console.log(formatToolCallStart(event));
          }
        },
        onDelta: (delta) => {
          if (!mainSpinnerStopped) {
            stopMainSpinner();
            mainSpinnerStopped = true;
          }
          streamBuffer += delta;
          // Если буфер содержит начало маркера — задерживаем вывод
          const markerIdx = streamBuffer.lastIndexOf("<!--");
          if (markerIdx !== -1 && !streamBuffer.includes("-->", markerIdx)) {
            // Выводим всё до маркера
            const safe = streamBuffer.slice(0, markerIdx);
            if (safe) process.stdout.write(safe);
            streamBuffer = streamBuffer.slice(markerIdx);
          } else if (streamBuffer.includes("-->")) {
            // Маркер завершён — выводим текст без маркера
            const clean = TaskPhasePrompts.stripTaskMarkers(streamBuffer);
            if (clean) process.stdout.write(clean);
            streamBuffer = "";
          } else {
            // Нет маркера — выводим всё
            process.stdout.write(streamBuffer);
            streamBuffer = "";
          }
        },
      });

      if (!mainSpinnerStopped) {
        stopMainSpinner();
        mainSpinnerStopped = true;
      }

      // Дописываем остаток буфера (если маркер не завершился)
      if (streamBuffer) {
        const clean = TaskPhasePrompts.stripTaskMarkers(streamBuffer);
        if (clean) process.stdout.write(clean);
      }

      // Tool-use всегда non-streaming, поэтому нужно вывести ответ
      const usedStreaming = config.useStreaming && !toolProvider;
      if (!usedStreaming) {
        const text = TaskPhasePrompts.stripTaskMarkers(result.response.content);
        if (text) process.stdout.write(text);
      }

      process.stdout.write("\n");

      if (config.debug && result.rawResponse) {
        printResponseDebug(result.rawResponse as any, Date.now());
      }

      if (result.costInfo) {
        console.log(pc.dim(costService.formatCost(result.costInfo)));
        if (config.debug && result.model) {
          console.error(pc.dim(`  Модель: ${result.model.name} (${result.model.id})`));
          console.error(pc.dim(`  Цена: $${result.model.inputPrice}/1M in, $${result.model.outputPrice}/1M out`));
        }
      }

      // Обработка маркеров задач в ответе с retry при невалидном переходе
      if (result.response.content && activeTask) {
        let taskUpdate = TaskPhasePrompts.parseTaskUpdate(result.response.content);

        if (taskUpdate) {
          if (taskUpdate.summary) {
            taskService.updateSummary(activeTask.id, taskUpdate.summary);
          }

          const isRealTransition = taskUpdate.transition && taskUpdate.transition !== activeTask.phase;

          if (isRealTransition) {
            const currentTask = taskService.getActiveTask(state.sessionId) ?? activeTask;
            const ok = taskService.transition(currentTask.id, taskUpdate.transition!);
            if (ok) {
              console.log(pc.cyan(`[Задача "${currentTask.title}"] → ${taskUpdate.transition}`));
            } else {
              // Retry-логика: до 5 попыток
              const MAX_RETRIES = 5;
              let retrySuccess = false;

              for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                const errorMsg = TaskPhasePrompts.buildInvalidTransitionMessage(currentTask, taskUpdate.transition!);
                console.log(pc.red(`[Задача] Невалидный переход: ${currentTask.phase} → ${taskUpdate.transition}`));

                const stopRetrySpinner = startSpinner(`Повторный запрос (попытка ${attempt}/${MAX_RETRIES})...`);
                try {
                  const retryResult = await chatService.sendMessage(state.sessionId, errorMsg, {
                    historyLimit: config.historyLimit,
                    systemPrompt,
                    useStreaming: false,
                    memoryBlocks: memoryService.getMemoryBlocks() || undefined,
                    temperature: config.temperature,
                    topP: config.topP,
                    maxCompletionTokens: config.maxCompletionTokens,
                    reasoningEffort: config.reasoningEffort,
                    reasoningSummary: config.reasoningSummary,
                  });
                  stopRetrySpinner();

                  const retryUpdate = TaskPhasePrompts.parseTaskUpdate(retryResult.response.content);
                  if (retryUpdate?.summary) {
                    taskService.updateSummary(currentTask.id, retryUpdate.summary);
                  }

                  const retryContent = TaskPhasePrompts.stripTaskMarkers(retryResult.response.content);
                  if (retryContent) {
                    process.stdout.write(retryContent + "\n");
                  }

                  if (retryResult.costInfo) {
                    console.log(pc.dim(costService.formatCost(retryResult.costInfo)));
                  }

                  if (retryUpdate?.transition && retryUpdate.transition !== currentTask.phase) {
                    const retryOk = taskService.transition(currentTask.id, retryUpdate.transition);
                    if (retryOk) {
                      console.log(pc.cyan(`[Задача "${currentTask.title}"] → ${retryUpdate.transition}`));
                      retrySuccess = true;
                      break;
                    }
                    // Невалидный снова — продолжаем retry
                    taskUpdate = retryUpdate;
                  } else {
                    // Нет перехода — LLM скорректировался
                    retrySuccess = true;
                    break;
                  }
                } catch (retryError) {
                  stopRetrySpinner();
                  console.log(pc.red(`[Retry] Ошибка: ${retryError instanceof Error ? retryError.message : String(retryError)}`));
                  break;
                }
              }

              if (!retrySuccess) {
                console.log(pc.yellow(`[Задача] Не удалось получить валидный переход после ${MAX_RETRIES} попыток`));
              }
            }
          }

          result.response.content = TaskPhasePrompts.stripTaskMarkers(result.response.content);
        }
      }


      if (result.response.content) {
        // Auto-title
        const session = sessionService.getSession(state.sessionId);
        if (session && !session.title) {
          const msgCount = sessionService.getMessageCount(state.sessionId);
          if (msgCount === 2) {
            generateTitle(openaiClient, modelRepo, text, result.response.content)
              .then((title) => {
                sessionService.autoTitle(state.sessionId, title);
              })
              .catch(() => {});
          }
        }

        // Memory reconciliation interval
        state.messagesSinceReconciliation++;
        const interval = Number(optionsRepo.get("memory_interval") ?? "5");
        if (interval > 0 && state.messagesSinceReconciliation >= interval) {
          state.messagesSinceReconciliation = 0;
          const dialogContent = `Пользователь: ${text}\nАссистент: ${result.response.content}`;
          await suggestMemorySave(deps, rl, dialogContent);
        }
      }
    } catch (error) {
      console.error(
        pc.red("Ошибка: " + (error instanceof Error ? error.message : String(error)))
      );
    }

    processing = false;
    rl.prompt();
  };

  rl.on("line", (line: string) => {
    if (processing) return;

    if (line.startsWith("/") && inputLines.length === 0) {
      processInput(line);
      return;
    }

    if (line === "" && inputLines.length > 0) {
      const text = inputLines.join("\n").trim();
      inputLines.length = 0;
      if (text) {
        processInput(text);
      } else {
        rl.prompt();
      }
      return;
    }

    if (line === "" && inputLines.length === 0) {
      rl.prompt();
      return;
    }

    inputLines.push(line);
  });

  rl.on("close", async () => {
    console.log("\n" + pc.dim("До свидания!"));
    schedulerService.stop();
    await deps.mcpConnectionManager.disconnectAll();
    process.exit(0);
  });
}
