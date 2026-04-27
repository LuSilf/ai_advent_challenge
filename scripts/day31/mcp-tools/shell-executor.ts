export type ShellResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type ShellExecutor = (cmd: string, args: string[], opts?: { cwd?: string }) => Promise<ShellResult>;

export const bunShellExecutor: ShellExecutor = async (cmd, args, opts) => {
  const proc = Bun.spawn([cmd, ...args], {
    cwd: opts?.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
};
