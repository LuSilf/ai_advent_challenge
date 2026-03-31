export type MemoryType = "longterm" | "working";

export interface MemoryStore {
  read(type: MemoryType): string;
  write(type: MemoryType, content: string): void;
  append(type: MemoryType, content: string): void;
  getPath(type: MemoryType): string;
}
