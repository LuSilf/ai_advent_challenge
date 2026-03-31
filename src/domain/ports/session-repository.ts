import type { Session, SessionWithCount } from "../models";

export interface SessionRepository {
  create(title?: string, contextStrategy?: string): number;
  getById(id: number): Session | null;
  getAll(): SessionWithCount[];
  update(id: number, fields: Partial<Pick<Session, "title" | "contextStrategy">>): void;
  delete(id: number): boolean;
  getLastSession(): Session | null;
  getStrategy(sessionId: number): string;
  setStrategy(sessionId: number, strategy: string): void;
  updateTitle(id: number, title: string): void;
  updateTitleIfNull(id: number, title: string): void;
  createBranch(parentSessionId: number, branchPointMessageId: number, title?: string, contextStrategy?: string): number;
  getBranches(sessionId: number): SessionWithCount[];
}
