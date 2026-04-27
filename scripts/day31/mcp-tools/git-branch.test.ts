import { describe, test, expect } from "bun:test";
import { gitBranch } from "./git-branch";
import type { ShellExecutor, ShellResult } from "./shell-executor";

function shell(result: ShellResult): ShellExecutor {
  return async () => result;
}

describe("gitBranch", () => {
  test("returns trimmed branch name", async () => {
    const ctx = { shellExec: shell({ stdout: "day31-dev-assistant-rag\n", stderr: "", exitCode: 0 }), projectRoot: "/p" };
    const r = await gitBranch(ctx);
    expect(r.isError).toBe(false);
    expect(r.content).toBe("day31-dev-assistant-rag");
  });

  test("non-zero exit returns isError", async () => {
    const ctx = { shellExec: shell({ stdout: "", stderr: "fatal: not a git repo", exitCode: 128 }), projectRoot: "/p" };
    const r = await gitBranch(ctx);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("not a git repo");
  });

  test("passes cwd to shell", async () => {
    let receivedCwd: string | undefined;
    const ctx = {
      shellExec: async (_cmd: string, _args: string[], opts?: { cwd?: string }) => {
        receivedCwd = opts?.cwd;
        return { stdout: "main\n", stderr: "", exitCode: 0 };
      },
      projectRoot: "/path/to/project",
    };
    await gitBranch(ctx);
    expect(receivedCwd).toBe("/path/to/project");
  });
});
