import type { Message } from "../models";

export interface MessageRepository {
  add(sessionId: number, role: "user" | "assistant", content: string): void;
  getBySession(sessionId: number, limit?: number): Message[];
  getCount(sessionId: number): number;
  deleteBySession(sessionId: number): void;
}
