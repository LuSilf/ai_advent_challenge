import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import pc from "picocolors";
import type OpenAI from "openai";
import type { Response } from "openai/resources/responses/responses";

import type { AppConfig } from "../../config";
import { applyDbOptions } from "../../config";
import { printOutputMarker, printRequestDebug, printResponseDebug, type DebugContext } from "../../debug-logger";

import type { SessionService } from "../../domain/services/session-service";
import type { ChatService } from "../../domain/services/chat-service";
import type { CostService } from "../../domain/services/cost-service";
import type { ModelRepository } from "../../domain/ports/model-repository";
import type { OptionsRepository } from "../../domain/ports/options-repository";
import type { CheckpointRepository } from "../../domain/ports/checkpoint-repository";
import type { LLMClient } from "../../domain/ports/llm-client";
import type { ProfileService } from "../../domain/services/profile-service";
import type { InvariantService } from "../../domain/services/invariant-service";

export type ReplDeps = {
  config: AppConfig;
  sessionService: SessionService;
  chatService: ChatService;
  costService: CostService;
  modelRepo: ModelRepository;
  optionsRepo: OptionsRepository;
  checkpointRepo: CheckpointRepository;
  llmClient: LLMClient;
  openaiClient: OpenAI;
  profileService: ProfileService;
  invariantService: InvariantService;
};

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
  console.log(pc.bold("Инварианты:"));
  console.log("  /invariant            Показать инварианты активного профиля");
  console.log("  /invariant add <текст> Добавить инвариант");
  console.log("  /invariant delete <id> Удалить инвариант");
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
  state: { sessionId: number },
  deps: ReplDeps,
  rl?: ReturnType<typeof createInterface>,
): Promise<string | null> {
  const { config, sessionService, costService, modelRepo, optionsRepo, checkpointRepo } = deps;

  switch (cmd) {
    case "/new": {
      state.sessionId = sessionService.createSession(undefined, config.contextStrategy);
      console.log(pc.green(`Создана новая сессия #${state.sessionId}`));
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
      state.sessionId = id;
      const count = sessionService.getMessageCount(id);
      printSessionInfo(id, session.title, count);
      const msgs = sessionService.getHistory(id, config.historyLimit).map((m) => ({
        role: m.role,
        content: m.content,
      }));
      printSessionMessages(msgs);
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
      console.log(pc.green(`Создана ветка #${newId} (${count} сообщений)`));
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
        console.log(`  ${i + 1}. #${b.id} ${name} — ${b.messageCount} сообщ.${marker}`);
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
      printSessionInfo(branch.id, branch.title, count);
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
      const validRoles = ["chat", "title"];
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
    case "/invariant": {
      const { profileService, invariantService } = deps;
      const activeProfile = profileService.getActiveProfile();
      if (!activeProfile) {
        console.log(pc.red("Нет активного профиля. Создайте: /profile create <имя>"));
        return null;
      }

      const subCmd = args.split(/\s+/)[0] || "";
      const subArgs = args.slice(subCmd.length).trim();

      switch (subCmd) {
        case "add": {
          const text = subArgs.trim();
          if (!text) {
            console.log(pc.red("Использование: /invariant add <текст>"));
            return null;
          }
          const inv = invariantService.add(activeProfile.id, text);
          console.log(pc.green(`Добавлен инвариант #${inv.id}: "${text}"`));
          return null;
        }
        case "delete": {
          const id = Number(subArgs);
          if (!Number.isInteger(id) || id < 1) {
            console.log(pc.red("Использование: /invariant delete <id>"));
            return null;
          }
          if (invariantService.delete(id)) {
            console.log(pc.green(`Инвариант #${id} удалён`));
          } else {
            console.log(pc.red(`Инвариант #${id} не найден`));
          }
          return null;
        }
        default: {
          // /invariant без аргументов — показать список
          const invariants = invariantService.getByProfile(activeProfile.id);
          if (invariants.length === 0) {
            console.log(pc.dim("Нет инвариантов"));
            return null;
          }
          console.log(pc.bold(`Инварианты профиля "${activeProfile.name}":`));
          for (const inv of invariants) {
            console.log(`  #${inv.id} ${inv.content}`);
          }
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
    case "/help": {
      printHelp();
      return null;
    }
    case "/exit": {
      process.exit(0);
    }
    default: {
      console.log(pc.red(`Неизвестная команда: ${cmd}. Введите /help`));
      return null;
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
  const { config, sessionService, chatService, costService, modelRepo, optionsRepo, openaiClient } = deps;
  const state = { sessionId: 0 };

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
  } else {
    state.sessionId = sessionService.createSession(undefined, config.contextStrategy);
    console.log(pc.green(`Создана новая сессия #${state.sessionId}`));
  }

  console.log(pc.dim("/new | /help"));

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
        });
      }

      if (config.debug) {
        printOutputMarker();
      }

      const result = await chatService.sendMessage(state.sessionId, text, {
        historyLimit: config.historyLimit,
        systemPrompt: config.systemPrompt,
        useStreaming: config.useStreaming,
        temperature: config.temperature,
        topP: config.topP,
        maxCompletionTokens: config.maxCompletionTokens,
        reasoningEffort: config.reasoningEffort,
        reasoningSummary: config.reasoningSummary,
        onDelta: (delta) => {
          process.stdout.write(delta);
        },
      });

      if (!config.useStreaming) {
        process.stdout.write(result.response.content);
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

  rl.on("close", () => {
    console.log("\n" + pc.dim("До свидания!"));
    process.exit(0);
  });
}
