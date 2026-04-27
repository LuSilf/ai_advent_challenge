import { describe, test, expect } from "bun:test";
import { gitStatus } from "./git-status";
import type { ShellExecutor } from "./shell-executor";

function shell(stdout: string, exitCode = 0, stderr = ""): ShellExecutor {
  return async () => ({ stdout, stderr, exitCode });
}

describe("gitStatus", () => {
  test("parses porcelain output into modified/untracked/staged", async () => {
    const out = [
      " M src/main.ts",
      "M  src/db.ts",
      "MM src/both.ts",
      "?? new-file.ts",
      "A  src/added.ts",
    ].join("\n");
    const ctx = { shellExec: shell(out), projectRoot: "/p" };
    const r = await gitStatus(ctx);
    expect(r.isError).toBe(false);
    const parsed = JSON.parse(r.content);
    expect(parsed.modified).toContain("src/main.ts");
    expect(parsed.modified).toContain("src/both.ts");
    expect(parsed.staged).toContain("src/db.ts");
    expect(parsed.staged).toContain("src/added.ts");
    expect(parsed.staged).toContain("src/both.ts");
    expect(parsed.untracked).toContain("new-file.ts");
  });

  test("empty output yields empty arrays", async () => {
    const ctx = { shellExec: shell(""), projectRoot: "/p" };
    const r = await gitStatus(ctx);
    expect(r.isError).toBe(false);
    const parsed = JSON.parse(r.content);
    expect(parsed.modified).toEqual([]);
    expect(parsed.staged).toEqual([]);
    expect(parsed.untracked).toEqual([]);
  });

  test("non-zero exit returns isError", async () => {
    const ctx = { shellExec: shell("", 128, "fatal: not a git repo"), projectRoot: "/p" };
    const r = await gitStatus(ctx);
    expect(r.isError).toBe(true);
  });
});
