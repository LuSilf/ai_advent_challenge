import type { ToolContext, ToolResult } from "./types";

export async function gitStatus(ctx: ToolContext): Promise<ToolResult> {
  const r = await ctx.shellExec("git", ["status", "--porcelain"], { cwd: ctx.projectRoot });
  if (r.exitCode !== 0) {
    return { content: r.stderr.trim() || "git status failed", isError: true };
  }

  const modified: string[] = [];
  const staged: string[] = [];
  const untracked: string[] = [];

  for (const rawLine of r.stdout.split("\n")) {
    if (rawLine.length === 0) continue;
    const indexCh = rawLine.charCodeAt(0);
    const workCh = rawLine.charCodeAt(1);
    const path = rawLine.slice(3);

    // ?? = untracked
    if (indexCh === 63 /* ? */ && workCh === 63) {
      untracked.push(path);
      continue;
    }

    // first column non-space ⇒ staged change
    if (indexCh !== 32 /* space */) {
      staged.push(path);
    }
    // second column non-space and non-? ⇒ unstaged modification
    if (workCh !== 32 && workCh !== 63) {
      modified.push(path);
    }
  }

  return {
    content: JSON.stringify({ modified, staged, untracked }, null, 2),
    isError: false,
  };
}
