import { describe, test, expect } from "bun:test";
import { gitDiff } from "./git-diff";

describe("gitDiff", () => {
  test("calls git diff without path when no path arg", async () => {
    let receivedArgs: string[] = [];
    const ctx = {
      shellExec: async (_cmd: string, args: string[]) => {
        receivedArgs = args;
        return { stdout: "diff content", stderr: "", exitCode: 0 };
      },
      projectRoot: "/p",
    };
    const r = await gitDiff(ctx, {});
    expect(r.isError).toBe(false);
    expect(receivedArgs).toEqual(["diff"]);
    expect(r.content).toBe("diff content");
  });

  test("appends -- <path> when path provided", async () => {
    let receivedArgs: string[] = [];
    const ctx = {
      shellExec: async (_cmd: string, args: string[]) => {
        receivedArgs = args;
        return { stdout: "diff", stderr: "", exitCode: 0 };
      },
      projectRoot: "/p",
    };
    await gitDiff(ctx, { path: "src/main.ts" });
    expect(receivedArgs).toEqual(["diff", "--", "src/main.ts"]);
  });

  test("truncates output above 5000 chars", async () => {
    const long = "x".repeat(6000);
    const ctx = {
      shellExec: async () => ({ stdout: long, stderr: "", exitCode: 0 }),
      projectRoot: "/p",
    };
    const r = await gitDiff(ctx, {});
    expect(r.content.length).toBeLessThanOrEqual(5100);
    expect(r.content).toContain("truncated");
  });

  test("non-zero exit returns isError", async () => {
    const ctx = {
      shellExec: async () => ({ stdout: "", stderr: "bad", exitCode: 1 }),
      projectRoot: "/p",
    };
    const r = await gitDiff(ctx, {});
    expect(r.isError).toBe(true);
  });
});
