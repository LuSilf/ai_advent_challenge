import type { ShellExecutor } from "./shell-executor";

export type ToolContext = {
  shellExec: ShellExecutor;
  projectRoot: string;
};

export type ToolResult = {
  content: string;
  isError: boolean;
};
