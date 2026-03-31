import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";

const SEPARATOR = "\n\n---\n\n";

function getMemoryDir(): string {
  return process.env.MEMORY_DIR || resolve(homedir(), ".config/ai_challenge_agent");
}

export function getLongTermMemoryPath(): string {
  return resolve(getMemoryDir(), "memory.md");
}

export function getWorkingMemoryPath(): string {
  return resolve(process.cwd(), ".ai/memory.md");
}

function readMemoryFile(path: string): string {
  try {
    return readFileSync(path, "utf-8").trim();
  } catch {
    return "";
  }
}

function appendToMemoryFile(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });

  const existing = readMemoryFile(path);
  const content = existing ? existing + SEPARATOR + text : text;
  writeFileSync(path, content, "utf-8");
}

export function readLongTermMemory(): string {
  return readMemoryFile(getLongTermMemoryPath());
}

export function readWorkingMemory(): string {
  return readMemoryFile(getWorkingMemoryPath());
}

export function appendLongTermMemory(text: string): void {
  appendToMemoryFile(getLongTermMemoryPath(), text);
}

export function appendWorkingMemory(text: string): void {
  appendToMemoryFile(getWorkingMemoryPath(), text);
}

export function writeLongTermMemory(content: string): void {
  writeMemoryFile(getLongTermMemoryPath(), content);
}

export function writeWorkingMemory(content: string): void {
  writeMemoryFile(getWorkingMemoryPath(), content);
}

function writeMemoryFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");
}

export function buildMemoryBlocks(): string {
  const parts: string[] = [];

  const longTerm = readLongTermMemory();
  if (longTerm) {
    parts.push(`[Долговременная память]\n${longTerm}`);
  }

  const working = readWorkingMemory();
  if (working) {
    parts.push(`[Рабочая память проекта]\n${working}`);
  }

  return parts.join("\n\n");
}
