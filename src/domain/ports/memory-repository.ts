export type MemoryType = "longterm" | "working";

export interface MemoryRepository {
  read(type: MemoryType): string;
  write(type: MemoryType, content: string): void;
  append(type: MemoryType, content: string): void;
  clear(type: MemoryType): void;
}
