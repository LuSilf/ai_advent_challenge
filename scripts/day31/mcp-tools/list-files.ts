import type { ToolContext, ToolResult } from "./types";

const IGNORE_PATTERNS = ["node_modules/**", ".git/**", "data/**", "**/*.lock"];
const MAX_RESULTS = 100;

export async function listFiles(ctx: ToolContext, args: { pattern: string }): Promise<ToolResult> {
  const pattern = args.pattern?.trim();
  if (!pattern) {
    return { content: "pattern is required and must be non-empty", isError: true };
  }
  const includeGlob = new Bun.Glob(pattern);
  const ignoreGlobs = IGNORE_PATTERNS.map((p) => new Bun.Glob(p));
  const out: string[] = [];
  for await (const path of includeGlob.scan({ cwd: ctx.projectRoot, dot: true, onlyFiles: true })) {
    let skip = false;
    for (const ig of ignoreGlobs) {
      if (ig.match(path)) {
        skip = true;
        break;
      }
    }
    if (!skip) {
      out.push(path);
      if (out.length >= MAX_RESULTS) break;
    }
  }
  return { content: JSON.stringify(out, null, 2), isError: false };
}
