import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "git-analyzer",
  version: "1.0.0",
});

async function runGit(...args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`git ${args[0]} failed: ${stderr.trim()}`);
  }

  return stdout.trim();
}

server.tool(
  "git_log",
  "Показывает последние коммиты репозитория",
  {
    count: z.number().default(10).describe("Количество коммитов"),
    author: z.string().optional().describe("Фильтр по автору"),
  },
  async ({ count, author }) => {
    const args = ["log", `--max-count=${count}`, "--format=%h %ad %an: %s", "--date=short"];
    if (author) {
      args.push(`--author=${author}`);
    }
    const result = await runGit(...args);
    return { content: [{ type: "text", text: result || "Нет коммитов" }] };
  },
);

server.tool(
  "git_diff",
  "Показывает изменения в репозитории",
  {
    target: z
      .string()
      .default("unstaged")
      .describe('Что сравнивать: "staged", "unstaged", или ref (например "HEAD~3..HEAD")'),
  },
  async ({ target }) => {
    let args: string[];
    if (target === "staged") {
      args = ["diff", "--cached", "--stat"];
    } else if (target === "unstaged") {
      args = ["diff", "--stat"];
    } else {
      args = ["diff", "--stat", target];
    }
    const result = await runGit(...args);
    return { content: [{ type: "text", text: result || "Нет изменений" }] };
  },
);

server.tool(
  "git_file_stats",
  "Статистика файлов в репозитории по расширениям",
  {},
  async () => {
    const files = await runGit("ls-files");
    const lines = files.split("\n").filter(Boolean);

    const stats = new Map<string, number>();
    for (const file of lines) {
      const dot = file.lastIndexOf(".");
      const ext = dot >= 0 ? file.slice(dot) : "(no ext)";
      stats.set(ext, (stats.get(ext) ?? 0) + 1);
    }

    const sorted = [...stats.entries()].sort((a, b) => b[1] - a[1]);
    const table = sorted.map(([ext, count]) => `${ext}: ${count}`).join("\n");
    const total = lines.length;

    return {
      content: [{ type: "text", text: `Всего файлов: ${total}\n\n${table}` }],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
