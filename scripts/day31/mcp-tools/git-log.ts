import type { ToolContext, ToolResult } from "./types";

const DEFAULT_LIMIT = 10;

export async function gitLog(ctx: ToolContext, args: { limit?: number }): Promise<ToolResult> {
  const limit = Number.isInteger(args.limit) && (args.limit ?? 0) > 0 ? args.limit! : DEFAULT_LIMIT;
  const r = await ctx.shellExec("git", ["log", "--oneline", "-n", String(limit)], { cwd: ctx.projectRoot });
  if (r.exitCode !== 0) {
    return { content: r.stderr.trim() || "git log failed", isError: true };
  }
  const lines = r.stdout.split("\n").filter((l) => l.length > 0);
  const out = lines.map((line) => {
    const sp = line.indexOf(" ");
    if (sp === -1) return { hash: line, subject: "" };
    return { hash: line.slice(0, sp), subject: line.slice(sp + 1) };
  });
  return { content: JSON.stringify(out, null, 2), isError: false };
}
