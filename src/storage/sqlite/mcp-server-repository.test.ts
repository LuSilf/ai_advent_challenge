import { describe, test, expect, beforeEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteMcpServerRepository } from "./mcp-server-repository";
import { initDb } from "../../db";

function freshDb(): void {
  const path = join(tmpdir(), `test-mcp-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  initDb(path);
}

describe("SqliteMcpServerRepository", () => {
  let repo: SqliteMcpServerRepository;

  beforeEach(() => {
    freshDb();
    repo = new SqliteMcpServerRepository();
  });

  test("getAll returns empty list initially", () => {
    expect(repo.getAll()).toEqual([]);
  });

  test("add and get server", () => {
    repo.add({ name: "test-server", command: "bun", args: ["run", "server.ts"] });
    const server = repo.get("test-server");
    expect(server).toEqual({ name: "test-server", command: "bun", args: ["run", "server.ts"] });
  });

  test("add server with no args", () => {
    repo.add({ name: "simple", command: "/usr/bin/server", args: [] });
    const server = repo.get("simple");
    expect(server).toEqual({ name: "simple", command: "/usr/bin/server", args: [] });
  });

  test("get returns null for unknown server", () => {
    expect(repo.get("nonexistent")).toBeNull();
  });

  test("add duplicate name throws", () => {
    repo.add({ name: "dup", command: "cmd1", args: [] });
    expect(() => repo.add({ name: "dup", command: "cmd2", args: [] })).toThrow();
  });

  test("getAll returns all servers sorted by name", () => {
    repo.add({ name: "beta", command: "cmd-b", args: [] });
    repo.add({ name: "alpha", command: "cmd-a", args: ["--flag"] });
    const all = repo.getAll();
    expect(all).toEqual([
      { name: "alpha", command: "cmd-a", args: ["--flag"] },
      { name: "beta", command: "cmd-b", args: [] },
    ]);
  });

  test("remove existing server returns true", () => {
    repo.add({ name: "to-remove", command: "cmd", args: [] });
    expect(repo.remove("to-remove")).toBe(true);
    expect(repo.get("to-remove")).toBeNull();
  });

  test("remove nonexistent server returns false", () => {
    expect(repo.remove("nonexistent")).toBe(false);
  });
});
