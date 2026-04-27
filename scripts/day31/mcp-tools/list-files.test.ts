import { describe, test, expect } from "bun:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listFiles } from "./list-files";

async function makeSandbox(files: string[]): Promise<string> {
  const root = join(tmpdir(), `list-files-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(root, { recursive: true });
  for (const path of files) {
    const full = join(root, path);
    await mkdir(join(full, "..").replace(/\/[^/]+$/, ""), { recursive: true }).catch(() => {});
    const dir = full.split("/").slice(0, -1).join("/");
    await mkdir(dir, { recursive: true }).catch(() => {});
    await writeFile(full, "x");
  }
  return root;
}

describe("listFiles", () => {
  test("returns paths matching glob pattern", async () => {
    const root = await makeSandbox(["a.ts", "b.md", "src/c.ts"]);
    const ctx = { shellExec: async () => ({ stdout: "", stderr: "", exitCode: 0 }), projectRoot: root };
    const r = await listFiles(ctx, { pattern: "**/*.ts" });
    expect(r.isError).toBe(false);
    const parsed = JSON.parse(r.content) as string[];
    expect(parsed.sort()).toEqual(["a.ts", "src/c.ts"]);
    await rm(root, { recursive: true, force: true });
  });

  test("ignores node_modules, .git, data, *.lock", async () => {
    const root = await makeSandbox([
      "src/main.ts",
      "node_modules/foo/index.ts",
      ".git/HEAD",
      "data/cache.ts",
      "bun.lock",
      "package.json",
    ]);
    const ctx = { shellExec: async () => ({ stdout: "", stderr: "", exitCode: 0 }), projectRoot: root };
    const r = await listFiles(ctx, { pattern: "**/*" });
    expect(r.isError).toBe(false);
    const parsed = JSON.parse(r.content) as string[];
    expect(parsed).toContain("src/main.ts");
    expect(parsed).toContain("package.json");
    expect(parsed).not.toContain("node_modules/foo/index.ts");
    expect(parsed).not.toContain(".git/HEAD");
    expect(parsed).not.toContain("data/cache.ts");
    expect(parsed).not.toContain("bun.lock");
    await rm(root, { recursive: true, force: true });
  });

  test("limits result to 100 entries", async () => {
    const files = Array.from({ length: 150 }, (_, i) => `file${i}.ts`);
    const root = await makeSandbox(files);
    const ctx = { shellExec: async () => ({ stdout: "", stderr: "", exitCode: 0 }), projectRoot: root };
    const r = await listFiles(ctx, { pattern: "*.ts" });
    expect(r.isError).toBe(false);
    const parsed = JSON.parse(r.content) as string[];
    expect(parsed.length).toBeLessThanOrEqual(100);
    await rm(root, { recursive: true, force: true });
  });

  test("invalid empty pattern is an error", async () => {
    const ctx = { shellExec: async () => ({ stdout: "", stderr: "", exitCode: 0 }), projectRoot: "/p" };
    const r = await listFiles(ctx, { pattern: "" });
    expect(r.isError).toBe(true);
  });
});
