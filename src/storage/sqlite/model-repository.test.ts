import { describe, test, expect, beforeEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteModelRepository } from "./model-repository";
import { initDb } from "../../db";

function freshDb(): string {
  const path = join(tmpdir(), `test-model-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  initDb(path);
  return path;
}

describe("SqliteModelRepository", () => {
  let repo: SqliteModelRepository;

  beforeEach(() => {
    freshDb();
    repo = new SqliteModelRepository();
  });

  test("getAll returns seeded models", () => {
    const models = repo.getAll();
    expect(models.length).toBe(7);
    const ids = models.map((m) => m.id);
    expect(ids).toContain("openai/gpt-5-nano");
    expect(ids).toContain("deepseek/deepseek-v3.2");
  });

  test("getAll returns domain Model format (camelCase)", () => {
    const models = repo.getAll();
    const nano = models.find((m) => m.id === "openai/gpt-5-nano")!;
    expect(nano.name).toBe("GPT-5 Nano");
    expect(nano.inputPrice).toBe(0.05);
    expect(nano.outputPrice).toBe(0.40);
    expect(nano.contextSize).toBe(400_000);
  });

  test("getById returns model by id", () => {
    const model = repo.getById("openai/gpt-5-nano");
    expect(model).not.toBeNull();
    expect(model!.name).toBe("GPT-5 Nano");
    expect(model!.inputPrice).toBe(0.05);
  });

  test("getById returns null for unknown id", () => {
    expect(repo.getById("nonexistent/model")).toBeNull();
  });

  test("getRole returns model for default chat role", () => {
    const model = repo.getRole("chat");
    expect(model).not.toBeNull();
    expect(model!.id).toBe("openai/gpt-5-nano");
  });

  test("getRole returns null for unknown role", () => {
    expect(repo.getRole("nonexistent")).toBeNull();
  });

  test("getRoles returns all default roles with model names", () => {
    const roles = repo.getRoles();
    expect(roles.length).toBe(3);
    const roleNames = roles.map((r) => r.role);
    expect(roleNames).toContain("chat");
    expect(roleNames).toContain("title");
    expect(roleNames).toContain("facts");
    // Check camelCase format
    expect(roles[0].modelId).toBeDefined();
    expect(roles[0].modelName).toBeDefined();
  });

  test("setRole changes model for role", () => {
    repo.setRole("chat", "deepseek/deepseek-v3.2");
    const model = repo.getRole("chat");
    expect(model).not.toBeNull();
    expect(model!.id).toBe("deepseek/deepseek-v3.2");
  });

  test("setRole throws for nonexistent model", () => {
    expect(() => repo.setRole("chat", "nonexistent/model")).toThrow();
  });
});
