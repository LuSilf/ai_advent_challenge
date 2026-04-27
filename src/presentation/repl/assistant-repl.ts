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

  let quitRequested = false;

  rl.on("SIGINT", () => {
    output.write("\n");
    quitRequested = true;
    rl.close();
  });

  output.write(
    pc.dim(
      "AI-ассистент проекта. Команды: /help <вопрос>, /reindex, /tools, /clear, /quit. Ctrl+C — выход.\n",
    ),
  );
  rl.prompt();

  for await (const line of rl) {
    const command = parseAssistantCommand(line);
    if (command) {
      try {
        await dispatchCommand(command, options.handlers, output);
      } catch (err) {
        output.write(pc.red(`Ошибка: ${err instanceof Error ? err.message : String(err)}\n`));
      }
      if (command.kind === "quit") {
        quitRequested = true;
        rl.close();
        return;
      }
    }
    rl.prompt();
  }

  // EOF (Ctrl+D / end of pipe). Treat as quit.
  if (!quitRequested) {
    await options.handlers.onQuit();
  }
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
