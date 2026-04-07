import { describe, test, expect } from "bun:test";
import { McpClientService } from "./mcp-client-service";
import { resolve } from "node:path";

const PROJECT_ROOT = resolve(import.meta.dir, "../../..");
const TEST_SERVER_PATH = resolve(PROJECT_ROOT, "scripts/test-mcp-server.ts");
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
});
