import { describe, test, expect } from "bun:test";
import { formatToolCallStart, formatToolCallResult, formatToolCall } from "./tool-use-formatter";
import pc from "picocolors";

// Strip ANSI codes for content assertions
function stripAnsi(str: string): string {
  return str.replace(/\x1B\[\d+m/g, "");
}

describe("ToolUseFormatter", () => {
  test("formatToolCallStart includes tool name", () => {
    const result = formatToolCallStart({
      toolName: "git-analyzer__git_log",
      serverName: "git-analyzer",
      description: "Показывает последние коммиты",
      arguments: { count: 5 },
    });

    const plain = stripAnsi(result);
    expect(plain).toContain("git-analyzer__git_log");
    expect(plain).toContain("git-analyzer");
    expect(plain).toContain("Показывает последние коммиты");
    expect(plain).toContain('"count": 5');
    expect(plain).toContain("─────────────────");
  });

  test("formatToolCallStart handles empty arguments", () => {
    const result = formatToolCallStart({
      toolName: "test__echo",
      serverName: "test",
      description: "Echo",
      arguments: {},
    });

    const plain = stripAnsi(result);
    expect(plain).toContain("{}");
  });

  test("formatToolCallStart works without server name", () => {
    const result = formatToolCallStart({
      toolName: "some_tool",
      serverName: "",
      description: "Test",
      arguments: {},
    });

    const plain = stripAnsi(result);
    expect(plain).toContain("some_tool");
    expect(plain).not.toContain("Сервер:");
  });

  test("formatToolCallResult shows successful result", () => {
    const result = formatToolCallResult({
      toolName: "git_log",
      serverName: "git-analyzer",
      description: "",
      arguments: {},
      result: "abc123 Initial commit",
      isError: false,
    });

    const plain = stripAnsi(result);
    expect(plain).toContain("Результат:");
    expect(plain).toContain("abc123 Initial commit");
  });

  test("formatToolCallResult shows error", () => {
    const result = formatToolCallResult({
      toolName: "git_log",
      serverName: "git-analyzer",
      description: "",
      arguments: {},
      result: "server unavailable",
      isError: true,
    });

    const plain = stripAnsi(result);
    expect(plain).toContain("Ошибка:");
    expect(plain).toContain("server unavailable");
  });

  test("formatToolCallResult truncates long output", () => {
    const longResult = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
    const result = formatToolCallResult({
      toolName: "git_log",
      serverName: "",
      description: "",
      arguments: {},
      result: longResult,
      isError: false,
    });

    const plain = stripAnsi(result);
    expect(plain).toContain("line 1");
    expect(plain).toContain("ещё 16 строк");
  });

  test("formatToolCallResult returns empty for undefined result", () => {
    const result = formatToolCallResult({
      toolName: "test",
      serverName: "",
      description: "",
      arguments: {},
    });

    expect(result).toBe("");
  });

  test("formatToolCall dispatches correctly", () => {
    // Without result → start format
    const start = formatToolCall({
      toolName: "test",
      serverName: "srv",
      description: "desc",
      arguments: { x: 1 },
    });
    expect(stripAnsi(start)).toContain("Вызов инструмента");

    // With result → result format
    const end = formatToolCall({
      toolName: "test",
      serverName: "srv",
      description: "desc",
      arguments: { x: 1 },
      result: "ok",
      isError: false,
    });
    expect(stripAnsi(end)).toContain("Результат:");
  });
});
