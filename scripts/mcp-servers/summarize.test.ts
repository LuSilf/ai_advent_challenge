import { describe, test, expect } from "bun:test";
import { McpClientService } from "../../src/domain/services/mcp-client-service";
import { resolve } from "node:path";

const PROJECT_ROOT = resolve(import.meta.dir, "../..");
const SUMMARIZE_SERVER_PATH = resolve(PROJECT_ROOT, "scripts/mcp-servers/summarize.ts");
const BUN_PATH = process.argv[0];

describe("Summarize MCP Server", () => {
  test("lists one tool: summarize", async () => {
    const service = new McpClientService();
    const tools = await service.listTools({
      name: "summarize",
      command: BUN_PATH,
      args: ["run", SUMMARIZE_SERVER_PATH],
      cwd: PROJECT_ROOT,
    });

    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe("summarize");
  });

  test("summarize returns non-empty text for valid input", async () => {
    const service = new McpClientService();
    const conn = await service.connect({
      name: "summarize",
      command: BUN_PATH,
      args: ["run", SUMMARIZE_SERVER_PATH],
      cwd: PROJECT_ROOT,
    });

    try {
      const result = await service.callTool(conn, "summarize", {
        text: "TypeScript is a typed superset of JavaScript that compiles to plain JavaScript. It adds optional static type checking, classes, interfaces, and other features. TypeScript was developed by Microsoft and first released in 2012. It has become one of the most popular programming languages for web development.",
        context: "Programming language overview",
      });

      expect(result.isError).toBe(false);
      expect(result.content).toBeTruthy();
      expect(result.content.length).toBeGreaterThan(10);
    } finally {
      await service.disconnect(conn);
    }
  }, 30_000);

  test("summarize returns error for empty text", async () => {
    const service = new McpClientService();
    const conn = await service.connect({
      name: "summarize",
      command: BUN_PATH,
      args: ["run", SUMMARIZE_SERVER_PATH],
      cwd: PROJECT_ROOT,
    });

    try {
      const result = await service.callTool(conn, "summarize", {
        text: "   ",
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain("пустой текст");
    } finally {
      await service.disconnect(conn);
    }
  });
});
