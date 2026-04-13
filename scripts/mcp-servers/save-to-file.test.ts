import { describe, test, expect, afterAll } from "bun:test";
import { McpClientService } from "../../src/domain/services/mcp-client-service";
import { resolve } from "node:path";
import { existsSync, unlinkSync } from "node:fs";

const PROJECT_ROOT = resolve(import.meta.dir, "../..");
const SAVE_SERVER_PATH = resolve(PROJECT_ROOT, "scripts/mcp-servers/save-to-file.ts");
const BUN_PATH = process.argv[0];

const createdFiles: string[] = [];

afterAll(() => {
  for (const f of createdFiles) {
    try { unlinkSync(f); } catch {}
  }
});

describe("Save-to-File MCP Server", () => {
  test("lists one tool: save_to_file", async () => {
    const service = new McpClientService();
    const tools = await service.listTools({
      name: "save-to-file",
      command: BUN_PATH,
      args: ["run", SAVE_SERVER_PATH],
      cwd: PROJECT_ROOT,
    });

    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe("save_to_file");
  });

  test("save_to_file creates a file with correct content", async () => {
    const service = new McpClientService();
    const conn = await service.connect({
      name: "save-to-file",
      command: BUN_PATH,
      args: ["run", SAVE_SERVER_PATH],
      cwd: PROJECT_ROOT,
    });

    const testFilename = `_test-output-${Date.now()}.md`;

    try {
      const result = await service.callTool(conn, "save_to_file", {
        filename: testFilename,
        content: "# Test\n\nHello world",
      });

      expect(result.isError).toBe(false);
      expect(result.content).toContain(testFilename);

      // Verify file was created
      const filePath = resolve(PROJECT_ROOT, testFilename);
      createdFiles.push(filePath);
      expect(existsSync(filePath)).toBe(true);

      const content = await Bun.file(filePath).text();
      expect(content).toBe("# Test\n\nHello world");
    } finally {
      await service.disconnect(conn);
    }
  });

  test("save_to_file rejects filename with path traversal", async () => {
    const service = new McpClientService();
    const conn = await service.connect({
      name: "save-to-file",
      command: BUN_PATH,
      args: ["run", SAVE_SERVER_PATH],
      cwd: PROJECT_ROOT,
    });

    try {
      const result = await service.callTool(conn, "save_to_file", {
        filename: "../etc/passwd",
        content: "malicious",
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain("недопустимое имя файла");
    } finally {
      await service.disconnect(conn);
    }
  });

  test("save_to_file rejects filename with slashes", async () => {
    const service = new McpClientService();
    const conn = await service.connect({
      name: "save-to-file",
      command: BUN_PATH,
      args: ["run", SAVE_SERVER_PATH],
      cwd: PROJECT_ROOT,
    });

    try {
      const result = await service.callTool(conn, "save_to_file", {
        filename: "subdir/file.md",
        content: "content",
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain("недопустимое имя файла");
    } finally {
      await service.disconnect(conn);
    }
  });

  test("save_to_file rejects empty content", async () => {
    const service = new McpClientService();
    const conn = await service.connect({
      name: "save-to-file",
      command: BUN_PATH,
      args: ["run", SAVE_SERVER_PATH],
      cwd: PROJECT_ROOT,
    });

    try {
      const result = await service.callTool(conn, "save_to_file", {
        filename: "test.md",
        content: "   ",
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain("пустой контент");
    } finally {
      await service.disconnect(conn);
    }
  });
});
