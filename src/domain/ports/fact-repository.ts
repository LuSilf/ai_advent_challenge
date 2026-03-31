import type { Fact } from "../models";

export interface FactRepository {
  getBySession(sessionId: number): Fact[];
  set(sessionId: number, facts: Fact[]): void;
  delete(sessionId: number): void;
}
