import type { ToolContext, ToolResult } from "./types";

const MAX_DIFF_CHARS = 5000;

export async function gitDiff(ctx: ToolContext, args: { path?: string }): Promise<ToolResult> {
  const cmd = ["diff"];
  if (args.path) cmd.push("--", args.path);
  const r = await ctx.shellExec("git", cmd, { cwd: ctx.projectRoot });
  if (r.exitCode !== 0) {
    return { content: r.stderr.trim() || "git diff failed", isError: true };
  }
  let content = r.stdout;
  if (content.length > MAX_DIFF_CHARS) {
    content = content.slice(0, MAX_DIFF_CHARS) + `\n[... truncated, ${r.stdout.length - MAX_DIFF_CHARS} chars omitted]`;
  }
  return { content, isError: false };
}
