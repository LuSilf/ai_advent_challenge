import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { IndexerFileSystem } from "../../domain/services/docs-indexer";

export function createBunGlobFs(rootDir: string): IndexerFileSystem {
  return {
    async glob(pattern: string, opts?: { ignore?: string[]; cwd?: string }): Promise<string[]> {
      const cwd = opts?.cwd ? resolve(rootDir, opts.cwd) : rootDir;
      const includeGlob = new Bun.Glob(pattern);
      const ignoreGlobs = (opts?.ignore ?? []).map((p) => new Bun.Glob(p));
      const out: string[] = [];
      for await (const path of includeGlob.scan({ cwd, dot: false, onlyFiles: true })) {
        let skip = false;
        for (const ig of ignoreGlobs) {
          if (ig.match(path)) {
            skip = true;
            break;
          }
        }
        if (!skip) out.push(path);
      }
      return out;
    },
    async readFile(path: string): Promise<string> {
      return readFile(resolve(rootDir, path), "utf8");
    },
  };
}
