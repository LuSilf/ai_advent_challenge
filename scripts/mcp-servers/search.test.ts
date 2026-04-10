import { describe, test, expect } from "bun:test";
import { McpClientService } from "../../src/domain/services/mcp-client-service";
import { resolve } from "node:path";

const PROJECT_ROOT = resolve(import.meta.dir, "../..");
const SEARCH_SERVER_PATH = resolve(PROJECT_ROOT, "scripts/mcp-servers/search.ts");
const BUN_PATH = process.argv[0];

describe("GitHub Search MCP Server", () => {
  test("lists two tools: search_pulls and search_issues", async () => {
    const service = new McpClientService();
    const tools = await service.listTools({
      name: "github-search",
      command: BUN_PATH,
      args: ["run", SEARCH_SERVER_PATH],
      cwd: PROJECT_ROOT,
    });

    expect(tools.length).toBe(2);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["search_issues", "search_pulls"]);
  });

  test("search_pulls returns valid JSON array for a real repo", async () => {
    const service = new McpClientService();
    const conn = await service.connect({
      name: "github-search",
      command: BUN_PATH,
      args: ["run", SEARCH_SERVER_PATH],
      cwd: PROJECT_ROOT,
    });

    try {
      const result = await service.callTool(conn, "search_pulls", {
        repo: "spring-projects/spring-boot",
        count: 1,
        state: "closed",
      });

      expect(result.isError).toBe(false);
      const data = JSON.parse(result.content);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);

      const pr = data[0];
      expect(pr).toHaveProperty("number");
      expect(pr).toHaveProperty("title");
      expect(pr).toHaveProperty("body");
      expect(pr).toHaveProperty("url");
      expect(pr).toHaveProperty("author");
      expect(pr).toHaveProperty("labels");
      expect(pr).toHaveProperty("comments");
      expect(typeof pr.number).toBe("number");
      expect(typeof pr.title).toBe("string");
      expect(Array.isArray(pr.comments)).toBe(true);
    } finally {
      await service.disconnect(conn);
    }
  }, 30_000);

  test("search_issues returns valid JSON array for a real repo", async () => {
    const service = new McpClientService();
    const conn = await service.connect({
      name: "github-search",
      command: BUN_PATH,
      args: ["run", SEARCH_SERVER_PATH],
      cwd: PROJECT_ROOT,
    });

    try {
      const result = await service.callTool(conn, "search_issues", {
        repo: "spring-projects/spring-boot",
        count: 1,
      });

      expect(result.isError).toBe(false);
      const data = JSON.parse(result.content);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);

      const issue = data[0];
      expect(issue).toHaveProperty("number");
      expect(issue).toHaveProperty("title");
      expect(issue).toHaveProperty("url");
      expect(issue).toHaveProperty("author");
      expect(issue).toHaveProperty("comments");
      expect(typeof issue.number).toBe("number");
    } finally {
      await service.disconnect(conn);
    }
  }, 30_000);

  test("search_pulls returns error for nonexistent repo", async () => {
    const service = new McpClientService();
    const conn = await service.connect({
      name: "github-search",
      command: BUN_PATH,
      args: ["run", SEARCH_SERVER_PATH],
      cwd: PROJECT_ROOT,
    });

    try {
      const result = await service.callTool(conn, "search_pulls", {
        repo: "nonexistent-owner-xyz/nonexistent-repo-abc",
        count: 1,
      });

      // Should return error content, not crash
      expect(result.content).toBeTruthy();
    } finally {
      await service.disconnect(conn);
    }
  }, 30_000);
});
