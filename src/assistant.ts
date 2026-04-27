import pc from "picocolors";

import { initDb } from "./db";
import { loadAssistantConfig } from "./domain/services/assistant-config";
import { runAssistantRepl } from "./presentation/repl/assistant-repl";
import { buildDocsIndexer, runReindex } from "./presentation/repl/assistant-reindex";

function fail(message: string): never {
  console.error(pc.red(message));
  process.exit(1);
}

const subcommand = process.argv[2];

const config = loadAssistantConfig((name) => process.env[name], fail);

initDb(config.dbPath);

if (subcommand === "reindex") {
  const indexer = buildDocsIndexer(config);
  await runReindex(indexer, process.stdout);
  process.exit(0);
}

if (subcommand !== undefined) {
  fail(`Unknown subcommand: ${subcommand}. Usage: bun run assistant [reindex]`);
}

console.log(pc.dim(`[assistant] llm: ${config.llmModel} via ${config.llmBaseUrl}`));
console.log(pc.dim(`[assistant] db: ${config.dbPath}, top_k=${config.topK}, tool_loop_max=${config.toolLoopMax}`));

const indexer = buildDocsIndexer(config);

const handlers = {
  async onHelp(question: string): Promise<void> {
    console.log(
      pc.yellow(`[stub] /help "${question}" — RAG не подключён, ждите phase 3`),
    );
  },
  async onReindex(): Promise<void> {
    await runReindex(indexer, process.stdout);
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
