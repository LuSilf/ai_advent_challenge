import pc from "picocolors";

import { loadAssistantConfig } from "./domain/services/assistant-config";
import { runAssistantRepl } from "./presentation/repl/assistant-repl";

function fail(message: string): never {
  console.error(pc.red(message));
  process.exit(1);
}

const subcommand = process.argv[2];

const config = loadAssistantConfig((name) => process.env[name], fail);

if (subcommand === "reindex") {
  console.error(pc.yellow("[assistant] reindex ещё не реализован — будет в phase 2"));
  process.exit(2);
}

if (subcommand !== undefined) {
  fail(`Unknown subcommand: ${subcommand}. Usage: bun run assistant [reindex]`);
}

console.log(pc.dim(`[assistant] llm: ${config.llmModel} via ${config.llmBaseUrl}`));
console.log(pc.dim(`[assistant] db: ${config.dbPath}, top_k=${config.topK}, tool_loop_max=${config.toolLoopMax}`));

const handlers = {
  async onHelp(question: string): Promise<void> {
    console.log(
      pc.yellow(`[stub] /help "${question}" — RAG не подключён, ждите phase 3`),
    );
  },
  async onReindex(): Promise<void> {
    console.log(pc.yellow("[stub] /reindex — индексация не реализована, ждите phase 2"));
  },
  async onTools(): Promise<void> {
    console.log(pc.yellow("[stub] /tools — MCP не подключён, ждите phase 4"));
  },
  async onClear(): Promise<void> {
    console.log(pc.dim("[clear] история пуста"));
  },
  async onQuit(): Promise<void> {
    console.log(pc.dim("[assistant] до встречи."));
    process.exit(0);
  },
};

await runAssistantRepl({ handlers });
