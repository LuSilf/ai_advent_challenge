import { describe, test, expect } from "bun:test";
import { gitLog } from "./git-log";
import type { ShellExecutor } from "./shell-executor";

describe("gitLog", () => {
  test("uses default limit 10 when not provided", async () => {
    let receivedArgs: string[] = [];
    const ctx = {
      shellExec: async (_cmd: string, args: string[]) => {
        receivedArgs = args;
        return { stdout: "abc Subject 1\n", stderr: "", exitCode: 0 };
      },
      projectRoot: "/p",
    };
    await gitLog(ctx, {});
    expect(receivedArgs).toContain("-n");
    expect(receivedArgs[receivedArgs.indexOf("-n") + 1]).toBe("10");
  });

  test("respects custom limit", async () => {
    let receivedArgs: string[] = [];
    const ctx = {
      shellExec: async (_cmd: string, args: string[]) => {
        receivedArgs = args;
        return { stdout: "", stderr: "", exitCode: 0 };
      },
      projectRoot: "/p",
    };
    await gitLog(ctx, { limit: 5 });
    expect(receivedArgs[receivedArgs.indexOf("-n") + 1]).toBe("5");
  });

  test("parses oneline output to array of {hash, subject}", async () => {
    const out = [
      "abc1234 first commit",
      "def5678 second commit",
    ].join("\n");
    const ctx = {
      shellExec: async () => ({ stdout: out, stderr: "", exitCode: 0 }),
      projectRoot: "/p",
    };
    const r = await gitLog(ctx, {});
    expect(r.isError).toBe(false);
    const parsed = JSON.parse(r.content) as Array<{ hash: string; subject: string }>;
    expect(parsed.length).toBe(2);
    expect(parsed[0]).toEqual({ hash: "abc1234", subject: "first commit" });
    expect(parsed[1]).toEqual({ hash: "def5678", subject: "second commit" });
  });

  test("invalid limit (0, negative, NaN) coerces to default", async () => {
    let receivedArgs: string[] = [];
    const ctx = {
      shellExec: async (_cmd: string, args: string[]) => {
        receivedArgs = args;
        return { stdout: "", stderr: "", exitCode: 0 };
      },
      projectRoot: "/p",
    };
    await gitLog(ctx, { limit: 0 });
    expect(receivedArgs[receivedArgs.indexOf("-n") + 1]).toBe("10");
    await gitLog(ctx, { limit: -3 });
    expect(receivedArgs[receivedArgs.indexOf("-n") + 1]).toBe("10");
  });

  test("non-zero exit returns isError", async () => {
    const ctx = {
      shellExec: async () => ({ stdout: "", stderr: "fatal", exitCode: 128 }),
      projectRoot: "/p",
    };
    const r = await gitLog(ctx, {});
    expect(r.isError).toBe(true);
  });
});
