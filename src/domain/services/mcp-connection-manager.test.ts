import { describe, test, expect, beforeEach } from "bun:test";
import { McpConnectionManager } from "./mcp-connection-manager";
import { McpClientService } from "./mcp-client-service";
import type { McpServerRepository } from "../ports/mcp-server-repository";
import type { McpServerConfig } from "../models";
import { resolve } from "node:path";

const PROJECT_ROOT = resolve(import.meta.dir, "../../..");
const TEST_SERVER_PATH = resolve(PROJECT_ROOT, "scripts/test-mcp-server.ts");
const GIT_ANALYZER_PATH = resolve(PROJECT_ROOT, "scripts/git-analyzer-server.ts");
const BUN_PATH = process.argv[0];

function makeConfig(name: string, scriptPath: string): McpServerConfig {
  return { name, command: BUN_PATH, args: ["run", scriptPath], cwd: PROJECT_ROOT };
}

function makeMockRepo(configs: McpServerConfig[]): McpServerRepository {
  return {
    add: () => {},
    get: (name: string) => configs.find((c) => c.name === name) ?? null,
    getAll: () => configs,
    remove: () => {},
  };
}

describe("McpConnectionManager", () => {
  let clientService: McpClientService;

  beforeEach(() => {
    clientService = new McpClientService();
  });

  test("connectAll connects to single server", async () => {
    const repo = makeMockRepo([makeConfig("test-server", TEST_SERVER_PATH)]);
    const manager = new McpConnectionManager(repo, clientService);

    const statuses = await manager.connectAll();
    expect(statuses.length).toBe(1);
    expect(statuses[0].status).toBe("connected");
    expect(statuses[0].serverName).toBe("test-server");
    expect(statuses[0].toolCount).toBe(3);

    await manager.disconnectAll();
  });

  test("connectAll connects to multiple servers", async () => {
    const repo = makeMockRepo([
      makeConfig("test-server", TEST_SERVER_PATH),
      makeConfig("git-analyzer", GIT_ANALYZER_PATH),
    ]);
    const manager = new McpConnectionManager(repo, clientService);

    const statuses = await manager.connectAll();
    expect(statuses.length).toBe(2);
    expect(statuses.every((s) => s.status === "connected")).toBe(true);

    await manager.disconnectAll();
  });

  test("connectAll handles failed server gracefully", async () => {
    const repo = makeMockRepo([
      makeConfig("test-server", TEST_SERVER_PATH),
      { name: "bad-server", command: "/nonexistent/binary", args: [] },
    ]);
    const manager = new McpConnectionManager(repo, clientService);

    const statuses = await manager.connectAll();
    expect(statuses.length).toBe(2);

    const good = statuses.find((s) => s.serverName === "test-server")!;
    expect(good.status).toBe("connected");

    const bad = statuses.find((s) => s.serverName === "bad-server")!;
    expect(bad.status).toBe("error");
    expect(bad.error).toBeTruthy();

    await manager.disconnectAll();
  });

  test("getAvailableTools aggregates tools from connected servers only", async () => {
    const repo = makeMockRepo([
      makeConfig("test-server", TEST_SERVER_PATH),
      { name: "bad-server", command: "/nonexistent/binary", args: [] },
    ]);
    const manager = new McpConnectionManager(repo, clientService);
    await manager.connectAll();

    const tools = manager.getAvailableTools();
    // Only tools from test-server (3 tools), none from bad-server
    expect(tools.length).toBe(3);
    expect(tools.every((t) => t.serverName === "test-server")).toBe(true);

    await manager.disconnectAll();
  });

  test("getAvailableTools includes serverName on each tool", async () => {
    const repo = makeMockRepo([
      makeConfig("test-server", TEST_SERVER_PATH),
      makeConfig("git-analyzer", GIT_ANALYZER_PATH),
    ]);
    const manager = new McpConnectionManager(repo, clientService);
    await manager.connectAll();

    const tools = manager.getAvailableTools();
    expect(tools.length).toBe(6); // 3 + 3

    const testTools = tools.filter((t) => t.serverName === "test-server");
    expect(testTools.length).toBe(3);

    const gitTools = tools.filter((t) => t.serverName === "git-analyzer");
    expect(gitTools.length).toBe(3);

    await manager.disconnectAll();
  });

  test("callTool calls tool on correct server", async () => {
    const repo = makeMockRepo([makeConfig("test-server", TEST_SERVER_PATH)]);
    const manager = new McpConnectionManager(repo, clientService);
    await manager.connectAll();

    const result = await manager.callTool("test-server", "echo", { text: "hello" });
    expect(result.content).toBe("hello");
    expect(result.isError).toBe(false);

    await manager.disconnectAll();
  });

  test("callTool returns error for unknown server", async () => {
    const repo = makeMockRepo([]);
    const manager = new McpConnectionManager(repo, clientService);

    const result = await manager.callTool("nonexistent", "echo", {});
    expect(result.isError).toBe(true);
    expect(result.content).toContain("не найден");
  });

  test("callTool returns error for disconnected server", async () => {
    const repo = makeMockRepo([
      { name: "bad-server", command: "/nonexistent/binary", args: [] },
    ]);
    const manager = new McpConnectionManager(repo, clientService);
    await manager.connectAll();

    const result = await manager.callTool("bad-server", "echo", {});
    expect(result.isError).toBe(true);
    expect(result.content).toContain("недоступен");

    await manager.disconnectAll();
  });

  test("getStatuses returns all server statuses", async () => {
    const repo = makeMockRepo([
      makeConfig("test-server", TEST_SERVER_PATH),
      { name: "bad-server", command: "/nonexistent/binary", args: [] },
    ]);
    const manager = new McpConnectionManager(repo, clientService);
    await manager.connectAll();

    const statuses = manager.getStatuses();
    expect(statuses.length).toBe(2);

    await manager.disconnectAll();
  });

  test("disconnectAll clears all connections", async () => {
    const repo = makeMockRepo([makeConfig("test-server", TEST_SERVER_PATH)]);
    const manager = new McpConnectionManager(repo, clientService);
    await manager.connectAll();

    expect(manager.getAvailableTools().length).toBe(3);

    await manager.disconnectAll();
    expect(manager.getAvailableTools().length).toBe(0);
    expect(manager.getStatuses().length).toBe(0);
  });
});
