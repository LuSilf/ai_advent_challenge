import type { ToolContext, ToolResult } from "./types";

export async function gitBranch(ctx: ToolContext): Promise<ToolResult> {
  const r = await ctx.shellExec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: ctx.projectRoot });
  if (r.exitCode !== 0) {
    return { content: r.stderr.trim() || "git rev-parse failed", isError: true };
  }
  return { content: r.stdout.trim(), isError: false };
}
