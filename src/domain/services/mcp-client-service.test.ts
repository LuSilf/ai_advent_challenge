import { describe, test, expect } from "bun:test";
import { McpClientService } from "./mcp-client-service";
import { resolve } from "node:path";

const PROJECT_ROOT = resolve(import.meta.dir, "../../..");
const TEST_SERVER_PATH = resolve(PROJECT_ROOT, "scripts/test-mcp-server.ts");
const GIT_ANALYZER_PATH = resolve(PROJECT_ROOT, "scripts/git-analyzer-server.ts");
const BUN_PATH = process.argv[0];

describe("McpClientService", () => {
  test("listTools returns tools from test MCP server", async () => {
    const service = new McpClientService();
    const tools = await service.listTools({
      name: "test-server",
      command: BUN_PATH,
      args: ["run", TEST_SERVER_PATH],
      cwd: PROJECT_ROOT,
    });

    expect(tools.length).toBe(3);

    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["add", "current_time", "echo"]);

    const echo = tools.find((t) => t.name === "echo")!;
    expect(echo.description).toBe("Повторяет переданный текст");

    const add = tools.find((t) => t.name === "add")!;
    expect(add.description).toBe("Складывает два числа");

    const time = tools.find((t) => t.name === "current_time")!;
    expect(time.description).toBe("Возвращает текущее время");
  });

  test("listTools throws for invalid command", async () => {
    const service = new McpClientService();
    await expect(
      service.listTools({
        name: "bad",
        command: "/nonexistent/binary",
        args: [],
      }),
    ).rejects.toThrow();
  });

  test("connect + callTool + disconnect lifecycle", async () => {
    const service = new McpClientService();
    const conn = await service.connect({
      name: "test-server",
      command: BUN_PATH,
      args: ["run", TEST_SERVER_PATH],
      cwd: PROJECT_ROOT,
    });

    try {
      const echoResult = await service.callTool(conn, "echo", { text: "hello" });
      expect(echoResult.content).toBe("hello");
      expect(echoResult.isError).toBe(false);

      const addResult = await service.callTool(conn, "add", { a: 2, b: 3 });
      expect(addResult.content).toBe("5");
      expect(addResult.isError).toBe(false);

      const timeResult = await service.callTool(conn, "current_time", {});
      expect(timeResult.content).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(timeResult.isError).toBe(false);
    } finally {
      await service.disconnect(conn);
    }
  });

  test("listToolsFromConnection works on open connection", async () => {
    const service = new McpClientService();
    const conn = await service.connect({
      name: "test-server",
      command: BUN_PATH,
      args: ["run", TEST_SERVER_PATH],
      cwd: PROJECT_ROOT,
    });

    try {
      const tools = await service.listToolsFromConnection(conn);
      expect(tools.length).toBe(3);
      expect(tools.map((t) => t.name).sort()).toEqual(["add", "current_time", "echo"]);
    } finally {
      await service.disconnect(conn);
    }
  });
});

describe("Git Analyzer MCP Server", () => {
  test("lists three tools", async () => {
    const service = new McpClientService();
    const tools = await service.listTools({
      name: "git-analyzer",
      command: BUN_PATH,
      args: ["run", GIT_ANALYZER_PATH],
      cwd: PROJECT_ROOT,
    });

    expect(tools.length).toBe(3);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["git_diff", "git_file_stats", "git_log"]);
  });

  test("git_log returns commit history", async () => {
    const service = new McpClientService();
    const conn = await service.connect({
      name: "git-analyzer",
      command: BUN_PATH,
      args: ["run", GIT_ANALYZER_PATH],
      cwd: PROJECT_ROOT,
    });

    try {
      const result = await service.callTool(conn, "git_log", { count: 3 });
      expect(result.isError).toBe(false);
      expect(result.content).toBeTruthy();
      // Должно быть максимум 3 строки (коммита)
      const lines = result.content.split("\n").filter(Boolean);
      expect(lines.length).toBeLessThanOrEqual(3);
      expect(lines.length).toBeGreaterThan(0);
    } finally {
      await service.disconnect(conn);
    }
  });

  test("git_diff returns diff info", async () => {
    const service = new McpClientService();
    const conn = await service.connect({
      name: "git-analyzer",
      command: BUN_PATH,
      args: ["run", GIT_ANALYZER_PATH],
      cwd: PROJECT_ROOT,
    });

    try {
      const result = await service.callTool(conn, "git_diff", { target: "unstaged" });
      expect(result.isError).toBe(false);
      // Может быть пустым если нет изменений — это ок
      expect(typeof result.content).toBe("string");
    } finally {
      await service.disconnect(conn);
    }
  });

  test("git_file_stats returns file statistics", async () => {
    const service = new McpClientService();
    const conn = await service.connect({
      name: "git-analyzer",
      command: BUN_PATH,
      args: ["run", GIT_ANALYZER_PATH],
      cwd: PROJECT_ROOT,
    });

    try {
      const result = await service.callTool(conn, "git_file_stats", {});
      expect(result.isError).toBe(false);
      expect(result.content).toContain("Всего файлов:");
      expect(result.content).toContain(".ts:");
    } finally {
      await service.disconnect(conn);
    }
  });
});
