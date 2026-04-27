import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { bunShellExecutor } from "./mcp-tools/shell-executor";
import type { ToolContext, ToolResult } from "./mcp-tools/types";
import { gitBranch } from "./mcp-tools/git-branch";
import { gitStatus } from "./mcp-tools/git-status";
import { gitLog } from "./mcp-tools/git-log";
import { gitDiff } from "./mcp-tools/git-diff";
import { listFiles } from "./mcp-tools/list-files";

const projectRoot = process.env.MCP_PROJECT_ROOT?.trim() || process.cwd();

const ctx: ToolContext = {
  shellExec: bunShellExecutor,
  projectRoot,
};

const server = new McpServer({
  name: "day31-project-tools",
  version: "0.1.0",
});

function asMcpResult(r: ToolResult) {
  return {
    content: [{ type: "text" as const, text: r.content }],
    isError: r.isError,
  };
}

server.tool(
  "git_branch",
  "Возвращает имя текущей git-ветки в проекте.",
  {},
  async () => asMcpResult(await gitBranch(ctx)),
);

server.tool(
  "git_status",
  "Возвращает JSON со списками изменённых, staged и untracked файлов (git status --porcelain).",
  {},
  async () => asMcpResult(await gitStatus(ctx)),
);

server.tool(
  "git_log",
  "Последние коммиты в формате [{hash, subject}, ...]. Параметр limit (по умолчанию 10).",
  {
    limit: z.number().int().positive().optional().describe("Сколько коммитов вернуть (default 10)"),
  },
  async ({ limit }) => asMcpResult(await gitLog(ctx, { limit })),
);

server.tool(
  "git_diff",
  "Diff незакоммиченных изменений. Опциональный path ограничивает diff одним файлом. Truncated to 5000 chars.",
  {
    path: z.string().optional().describe("Путь файла для diff (опционально)"),
  },
  async ({ path }) => asMcpResult(await gitDiff(ctx, { path })),
);

server.tool(
  "list_files",
  "Listing файлов проекта по glob-паттерну. Игнорирует node_modules, .git, data, *.lock. Max 100 paths.",
  {
    pattern: z.string().min(1).describe("Glob-паттерн, например 'src/**/*.ts' или 'README.md'"),
  },
  async ({ pattern }) => asMcpResult(await listFiles(ctx, { pattern })),
);

const transport = new StdioServerTransport();
await server.connect(transport);
