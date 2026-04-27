import readline from "node:readline";
import pc from "picocolors";

import { parseAssistantCommand, type AssistantCommand } from "./assistant-slash-parser";

export type ReplHandlers = {
  onHelp: (question: string) => Promise<void>;
  onReindex: () => Promise<void>;
  onTools: () => Promise<void>;
  onClear: () => Promise<void>;
  onQuit: () => Promise<void>;
};

export type ReplOptions = {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  handlers: ReplHandlers;
};

export async function runAssistantRepl(options: ReplOptions): Promise<void> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;

  const rl = readline.createInterface({
    input,
    output,
    prompt: pc.bold(pc.cyan("assistant> ")),
    terminal: process.stdout.isTTY,
  });

  let stopped = false;

  const stop = async () => {
    if (stopped) return;
    stopped = true;
    rl.close();
    await options.handlers.onQuit();
  };

  rl.on("SIGINT", () => {
    output.write("\n");
    void stop();
  });

  rl.on("close", () => {
    if (!stopped) {
      stopped = true;
      void options.handlers.onQuit();
    }
  });

  output.write(
    pc.dim(
      "AI-ассистент проекта. Команды: /help <вопрос>, /reindex, /tools, /clear, /quit. Ctrl+C — выход.\n",
    ),
  );
  rl.prompt();

  for await (const line of rl) {
    if (stopped) break;
    const command = parseAssistantCommand(line);
    if (command) {
      try {
        await dispatchCommand(command, options.handlers, output);
      } catch (err) {
        output.write(pc.red(`Ошибка: ${err instanceof Error ? err.message : String(err)}\n`));
      }
    }
    if (stopped) break;
    rl.prompt();
  }

  await stop();
}

async function dispatchCommand(
  command: AssistantCommand,
  handlers: ReplHandlers,
  output: NodeJS.WritableStream,
): Promise<void> {
  switch (command.kind) {
    case "help":
      await handlers.onHelp(command.question);
      return;
    case "reindex":
      await handlers.onReindex();
      return;
    case "tools":
      await handlers.onTools();
      return;
    case "clear":
      await handlers.onClear();
      return;
    case "quit":
      await handlers.onQuit();
      return;
    case "error":
      output.write(pc.yellow(`${command.message}\n`));
      return;
  }
}
