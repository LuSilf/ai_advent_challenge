import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import OpenAI from "openai";
import pc from "picocolors";
import type { Response } from "openai/resources/responses/responses";

import type { AppConfig } from "./config";
import type { ChatMessage } from "./request";
import { buildResponseRequest } from "./request";
import { printOutputMarker, printRequestDebug, printResponseDebug } from "./debug-logger";
import {
  createSession,
  getLastSession,
  getSession,
  listSessions,
  deleteSession,
  renameSession,
  updateSessionTitle,
  addMessage,
  getMessages,
  getMessageCount,
  clearMessages,
  getSessionStrategy,
  setSessionStrategy,
  getFacts,
  upsertFacts,
  createCheckpoint,
  getLastCheckpoint,
  createBranch,
  listBranches,
  listModels,
  listModelRoles,
  setModelForRole,
  getModelForRole,
  getModel,
  calculateCost,
  formatCost
} from "./db";
import { createStrategy, isValidStrategy, buildFactsExtractionInput, parseFactsResponse, FACTS_EXTRACTION_PROMPT } from "./strategy";

function printCostInfo(response: Response | undefined, modelId: string, debug: boolean): void {
  if (!response?.usage) return;

  const model = getModelForRole("chat") ?? getModel(modelId);
  if (!model) return;

  const costInfo = calculateCost(model, response.usage.input_tokens, response.usage.output_tokens);
  console.log(pc.dim(formatCost(costInfo)));

  if (debug) {
    console.error(pc.dim(`  Модель: ${model.name} (${model.id})`));
    console.error(pc.dim(`  Цена: $${model.input_price}/1M in, $${model.output_price}/1M out`));
  }
}

async function generateTitle(
  client: OpenAI,
  userMessage: string,
  assistantMessage: string
): Promise<string> {
  const titleModel = getModelForRole("title");
  const response = await client.responses.create({
    model: titleModel?.id ?? "openai/gpt-5-nano",
    instructions:
      "Придумай короткое название (до 50 символов) для диалога по первому обмену сообщениями. Ответь только названием, без кавычек.",
    input: `Пользователь: ${userMessage}\nАссистент: ${assistantMessage}`,
    stream: false
  });
  return response.output_text?.trim() || "Без названия";
}

async function sendMessage(
  client: OpenAI,
  config: AppConfig,
  prompt: string,
  history: ChatMessage[],
  factsBlock?: string
): Promise<{ text: string; response?: Response }> {
  const chatModel = getModelForRole("chat");
  const modelId = chatModel?.id ?? "openai/gpt-5-nano";
  const configWithPrompt = { ...config, prompt };
  const request = buildResponseRequest(configWithPrompt, modelId, history, factsBlock);
  const startedAtMs = Date.now();

  if (config.debug) {
    printRequestDebug(configWithPrompt, modelId);
  }

  let responseText = "";

  if (config.useStreaming) {
    const stream = await client.responses.create({ ...request, stream: true });
    let completedResponse: Response | undefined;
    const reasoningSummaryParts: string[] = [];

    if (config.debug) {
      printOutputMarker();
    }

    for await (const event of stream) {
      if (event.type === "response.output_text.delta" && event.delta.length > 0) {
        process.stdout.write(event.delta);
        responseText += event.delta;
      }

      if (event.type === "response.reasoning_summary_text.done") {
        const text = event.text.trim();
        if (text) {
          reasoningSummaryParts.push(text);
        }
      }

      if (event.type === "response.completed") {
        completedResponse = event.response;
      }
    }

    if (!responseText && completedResponse?.output_text) {
      responseText = completedResponse.output_text;
      process.stdout.write(responseText);
    }

    process.stdout.write("\n");

    if (config.debug && completedResponse) {
      printResponseDebug(completedResponse, startedAtMs, reasoningSummaryParts);
    }

    printCostInfo(completedResponse, modelId, config.debug);

    return { text: responseText, response: completedResponse };
  } else {
    const response = await client.responses.create({ ...request, stream: false });
    responseText = response.output_text ?? "";

    if (config.debug) {
      printOutputMarker();
    }

    process.stdout.write(responseText + "\n");

    if (config.debug) {
      printResponseDebug(response, startedAtMs);
    }

    printCostInfo(response, modelId, config.debug);

    return { text: responseText, response };
  }
}

function printSessionInfo(sessionId: number, title: string | null, messageCount: number): void {
  const name = title ? `"${title}"` : "(без названия)";
  console.log(pc.cyan(`Сессия #${sessionId}: ${name} (${messageCount} сообщений)`));
}

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
  console.log(pc.bold("Стратегии контекста:"));
  console.log("  /strategy [name]  Показать/сменить стратегию (full|sliding|facts)");
  console.log("  /facts            Показать извлечённые факты сессии");
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
  console.log("  /help             Показать эту справку");
  console.log("  /exit             Выход (или Ctrl+D)");
  console.log(pc.dim("Введите сообщение и нажмите Enter дважды для отправки."));
}

function handleCommand(
  cmd: string,
  args: string,
  state: { sessionId: number },
  config: AppConfig
): string | null {
  switch (cmd) {
    case "/new": {
      state.sessionId = createSession(undefined, config.contextStrategy);
      console.log(pc.green(`Создана новая сессия #${state.sessionId} (стратегия: ${config.contextStrategy})`));
      return null;
    }
    case "/list": {
      const sessions = listSessions();
      if (sessions.length === 0) {
        console.log(pc.dim("Нет сессий"));
        return null;
      }
      for (const s of sessions) {
        const marker = s.id === state.sessionId ? pc.yellow(" ←") : "";
        const name = s.title ? `"${s.title}"` : "(без названия)";
        console.log(`  #${s.id} ${name} — ${s.message_count} сообщений, ${s.updated_at}${marker}`);
      }
      return null;
    }
    case "/switch": {
      const id = Number(args);
      if (!Number.isInteger(id) || id < 1) {
        console.log(pc.red("Укажите номер сессии: /switch N"));
        return null;
      }
      const session = getSession(id);
      if (!session) {
        console.log(pc.red(`Сессия #${id} не найдена`));
        return null;
      }
      state.sessionId = id;
      const count = getMessageCount(id);
      printSessionInfo(id, session.title, count);
      const msgs = getMessages(id, config.historyLimit).map((m) => ({
        role: m.role,
        content: m.content
      }));
      printSessionMessages(msgs);
      return null;
    }
    case "/clear": {
      clearMessages(state.sessionId);
      console.log(pc.green(`Сообщения сессии #${state.sessionId} очищены`));
      return null;
    }
    case "/delete": {
      const id = Number(args);
      if (!Number.isInteger(id) || id < 1) {
        console.log(pc.red("Укажите номер сессии: /delete N"));
        return null;
      }
      if (deleteSession(id)) {
        console.log(pc.green(`Сессия #${id} удалена`));
        if (id === state.sessionId) {
          state.sessionId = createSession(undefined, config.contextStrategy);
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
      renameSession(state.sessionId, args.trim());
      console.log(pc.green(`Сессия #${state.sessionId} переименована: "${args.trim()}"`));
      return null;
    }
    case "/history": {
      const msgs = getMessages(state.sessionId);
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
        const current = getSessionStrategy(state.sessionId);
        console.log(pc.cyan(`Текущая стратегия: ${current}`));
        console.log(pc.dim("Доступные: full, sliding, facts"));
        return null;
      }
      const name = args.trim().toLowerCase();
      if (!isValidStrategy(name)) {
        console.log(pc.red(`Неизвестная стратегия: ${name}. Доступные: full, sliding, facts`));
        return null;
      }
      setSessionStrategy(state.sessionId, name);
      console.log(pc.green(`Стратегия сменена на: ${name}`));
      return null;
    }
    case "/facts": {
      const facts = getFacts(state.sessionId);
      if (facts.length === 0) {
        console.log(pc.dim("Фактов нет"));
        return null;
      }
      console.log(pc.bold("Факты сессии:"));
      for (const f of facts) {
        console.log(`  ${pc.cyan(f.key)}: ${f.value}`);
      }
      return null;
    }
    case "/checkpoint": {
      try {
        const msgId = createCheckpoint(state.sessionId);
        console.log(pc.green(`Checkpoint создан (сообщение #${msgId})`));
      } catch (e) {
        console.log(pc.red(e instanceof Error ? e.message : String(e)));
      }
      return null;
    }
    case "/branch": {
      const checkpoint = getLastCheckpoint(state.sessionId);
      if (!checkpoint) {
        console.log(pc.red("Нет checkpoint. Сначала используйте /checkpoint"));
        return null;
      }
      const branchTitle = args.trim() || undefined;
      const newId = createBranch(state.sessionId, checkpoint.message_id, branchTitle);
      state.sessionId = newId;
      const count = getMessageCount(newId);
      const strategy = getSessionStrategy(newId);
      console.log(pc.green(`Создана ветка #${newId} (${count} сообщений, стратегия: ${strategy})`));
      return null;
    }
    case "/branches": {
      const branches = listBranches(state.sessionId);
      if (branches.length === 0) {
        console.log(pc.dim("Нет веток"));
        return null;
      }
      console.log(pc.bold("Ветки:"));
      for (let i = 0; i < branches.length; i++) {
        const b = branches[i];
        const marker = b.id === state.sessionId ? pc.yellow(" ←") : "";
        const name = b.title ? `"${b.title}"` : "(без названия)";
        const strategy = getSessionStrategy(b.id);
        console.log(`  ${i + 1}. #${b.id} ${name} — ${b.message_count} сообщ., стратегия: ${strategy}${marker}`);
      }
      return null;
    }
    case "/switch-branch": {
      const branches = listBranches(state.sessionId);
      const idx = Number(args) - 1;
      if (!Number.isInteger(idx) || idx < 0 || idx >= branches.length) {
        console.log(pc.red(`Укажите номер ветки (1-${branches.length}): /switch-branch N`));
        return null;
      }
      const branch = branches[idx];
      state.sessionId = branch.id;
      const count = getMessageCount(branch.id);
      const strategy = getSessionStrategy(branch.id);
      printSessionInfo(branch.id, branch.title, count);
      console.log(pc.dim(`Стратегия: ${strategy}`));
      return null;
    }
    case "/models": {
      const models = listModels();
      if (models.length === 0) {
        console.log(pc.dim("Нет моделей"));
        return null;
      }

      const rows = models.map((m) => ({
        id: m.id,
        name: m.name,
        input: `$${m.input_price}`,
        output: `$${m.output_price}`,
        ctx: m.context_size >= 1_000_000
          ? `${(m.context_size / 1_000_000).toFixed(1)}M`
          : `${(m.context_size / 1_000).toFixed(0)}K`,
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
      const roles = listModelRoles();
      if (roles.length === 0) {
        console.log(pc.dim("Нет назначенных ролей"));
        return null;
      }
      console.log(pc.bold("Роли:"));
      for (const r of roles) {
        console.log(`  ${pc.cyan(r.role.padEnd(8))} → ${r.model_id} (${r.model_name})`);
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
        setModelForRole(role, modelId);
        console.log(pc.green(`Роль "${role}" → ${modelId}`));
      } catch (e) {
        console.log(pc.red(e instanceof Error ? e.message : String(e)));
      }
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

export async function startRepl(client: OpenAI, config: AppConfig): Promise<void> {
  const state = { sessionId: 0 };

  // Восстанавливаем последнюю сессию или создаём новую
  const lastSession = getLastSession();
  if (lastSession) {
    state.sessionId = lastSession.id;
    const count = getMessageCount(lastSession.id);
    printSessionInfo(lastSession.id, lastSession.title, count);
    const msgs = getMessages(lastSession.id, config.historyLimit).map((m) => ({
      role: m.role,
      content: m.content
    }));
    printSessionMessages(msgs);
  } else {
    state.sessionId = createSession(undefined, config.contextStrategy);
    console.log(pc.green(`Создана новая сессия #${state.sessionId} (стратегия: ${config.contextStrategy})`));
  }

  console.log(pc.dim("Стратегия: " + getSessionStrategy(state.sessionId) + " | /new | /help"));

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: pc.green("> ")
  });

  rl.prompt();

  const inputLines: string[] = [];

  const processInput = async (text: string) => {
    // Команды
    if (text.startsWith("/")) {
      const spaceIdx = text.indexOf(" ");
      const cmd = spaceIdx === -1 ? text : text.slice(0, spaceIdx);
      const args = spaceIdx === -1 ? "" : text.slice(spaceIdx + 1);
      const result = handleCommand(cmd, args, state, config);
      if (result === null) {
        rl.prompt();
        return;
      }
      text = result;
    }

    // Отправка сообщения
    const strategyName = getSessionStrategy(state.sessionId);
    const currentStrategy = createStrategy(strategyName);
    const { messages: history, factsBlock } = currentStrategy.buildMessages(state.sessionId, config.historyLimit);

    addMessage(state.sessionId, "user", text);

    try {
      const { text: responseText } = await sendMessage(client, config, text, history, factsBlock);

      if (responseText) {
        addMessage(state.sessionId, "assistant", responseText);

        // Извлечение фактов (стратегия facts)
        if (strategyName === "facts") {
          try {
            const factsModel = getModelForRole("facts");
            const factsModelId = factsModel?.id ?? "openai/gpt-5-nano";
            const currentFacts = getFacts(state.sessionId);
            const factsInput = buildFactsExtractionInput(currentFacts, text, responseText);
            const factsResponse = await client.responses.create({
              model: factsModelId,
              instructions: FACTS_EXTRACTION_PROMPT,
              input: factsInput,
              stream: false,
            });
            const factsText = factsResponse.output_text?.trim();
            if (factsText) {
              const newFacts = parseFactsResponse(factsText);
              upsertFacts(state.sessionId, newFacts);
              if (config.debug) {
                console.error(pc.dim(`[Facts] Обновлено ${newFacts.length} фактов`));
              }
            }
          } catch (e) {
            if (config.debug) {
              console.error(pc.dim(`[Facts] Ошибка извлечения: ${e instanceof Error ? e.message : String(e)}`));
            }
          }
        }

        // Автоименование после первого обмена
        const session = getSession(state.sessionId);
        if (session && !session.title) {
          const msgCount = getMessageCount(state.sessionId);
          if (msgCount === 2) {
            generateTitle(client, text, responseText)
              .then((title) => {
                updateSessionTitle(state.sessionId, title);
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

    rl.prompt();
  };

  rl.on("line", (line: string) => {
    // Команды выполняются сразу по Enter, без ожидания пустой строки
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
