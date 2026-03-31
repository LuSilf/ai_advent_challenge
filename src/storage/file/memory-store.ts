import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { MemoryStore, MemoryType } from "../../domain/ports/memory-store";

const SEPARATOR = "\n\n---\n\n";

export class FileMemoryStore implements MemoryStore {
  constructor(
    private readonly longtermPath: string,
    private readonly workingPath: string,
  ) {}

  read(type: MemoryType): string {
    const path = this.getPath(type);
    try {
      return readFileSync(path, "utf-8").trim();
    } catch {
      return "";
    }
  }

  write(type: MemoryType, content: string): void {
    const path = this.getPath(type);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf-8");
  }

  append(type: MemoryType, content: string): void {
    const path = this.getPath(type);
    mkdirSync(dirname(path), { recursive: true });

    const existing = this.read(type);
    const newContent = existing ? existing + SEPARATOR + content : content;
    writeFileSync(path, newContent, "utf-8");
  }

  getPath(type: MemoryType): string {
    return type === "longterm" ? this.longtermPath : this.workingPath;
  }
}
