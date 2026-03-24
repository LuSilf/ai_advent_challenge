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
  clearMessages
} from "./db";

async function generateTitle(
  client: OpenAI,
  config: AppConfig,
  userMessage: string,
  assistantMessage: string
): Promise<string> {
  const response = await client.responses.create({
    model: config.titleModel,
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
  history: ChatMessage[]
): Promise<string> {
  const configWithPrompt = { ...config, prompt };
  const request = buildResponseRequest(configWithPrompt, history);
  const startedAtMs = Date.now();

  if (config.debug) {
    printRequestDebug(configWithPrompt);
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
  }

  return responseText;
}

function printSessionInfo(sessionId: number, title: string | null, messageCount: number): void {
  const name = title ? `"${title}"` : "(без названия)";
  console.log(pc.cyan(`Сессия #${sessionId}: ${name} (${messageCount} сообщений)`));
}

function printLastMessages(messages: ChatMessage[], count = 4): void {
  const last = messages.slice(-count);
  if (last.length === 0) return;

  console.log(pc.dim("Последние сообщения:"));
  for (const msg of last) {
    const prefix = msg.role === "user" ? pc.green("  Вы: ") : pc.blue("  Бот: ");
    const text = msg.content.length > 80 ? msg.content.slice(0, 77) + "..." : msg.content;
    console.log(prefix + text.replace(/\n/g, " "));
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
      state.sessionId = createSession();
      console.log(pc.green(`Создана новая сессия #${state.sessionId}`));
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
      printLastMessages(msgs);
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
          state.sessionId = createSession();
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
    printLastMessages(msgs);
  } else {
    state.sessionId = createSession();
    console.log(pc.green(`Создана новая сессия #${state.sessionId}`));
  }

  console.log(pc.dim("Для новой сессии: /new | Помощь: /help"));

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
    const history = getMessages(state.sessionId, config.historyLimit).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content
    }));

    addMessage(state.sessionId, "user", text);

    try {
      const responseText = await sendMessage(client, config, text, history);

      if (responseText) {
        addMessage(state.sessionId, "assistant", responseText);

        // Автоименование после первого обмена
        const session = getSession(state.sessionId);
        if (session && !session.title) {
          const msgCount = getMessageCount(state.sessionId);
          if (msgCount === 2) {
            generateTitle(client, config, text, responseText)
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
