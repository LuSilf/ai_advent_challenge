import type { Session, SessionWithCount, Message } from "../models";
import type { SessionRepository } from "../ports/session-repository";
import type { MessageRepository } from "../ports/message-repository";

export class SessionService {
  constructor(
    private readonly sessionRepo: SessionRepository,
    private readonly messageRepo: MessageRepository,
  ) {}

  createSession(title?: string, contextStrategy?: string): number {
    return this.sessionRepo.create(title, contextStrategy);
  }

  getSession(id: number): Session | null {
    return this.sessionRepo.getById(id);
  }

  listSessions(): SessionWithCount[] {
    return this.sessionRepo.getAll();
  }

  deleteSession(id: number): boolean {
    return this.sessionRepo.delete(id);
  }

  renameSession(id: number, title: string): void {
    this.sessionRepo.updateTitle(id, title);
  }

  getHistory(id: number, limit?: number): Message[] {
    return this.messageRepo.getBySession(id, limit);
  }

  addMessage(sessionId: number, role: "user" | "assistant", content: string): void {
    this.messageRepo.add(sessionId, role, content);
  }

  clearMessages(sessionId: number): void {
    this.messageRepo.deleteBySession(sessionId);
  }

  getMessageCount(sessionId: number): number {
    return this.messageRepo.getCount(sessionId);
  }

  getLastSession(): Session | null {
    return this.sessionRepo.getLastSession();
  }

  getStrategy(sessionId: number): string {
    return this.sessionRepo.getStrategy(sessionId);
  }

  setStrategy(sessionId: number, strategy: string): void {
    this.sessionRepo.setStrategy(sessionId, strategy);
  }

  autoTitle(sessionId: number, title: string): void {
    this.sessionRepo.updateTitleIfNull(sessionId, title);
  }

  createBranch(parentSessionId: number, branchPointMessageId: number, title?: string): number {
    return this.sessionRepo.createBranch(parentSessionId, branchPointMessageId, title);
  }

  getBranches(sessionId: number): SessionWithCount[] {
    return this.sessionRepo.getBranches(sessionId);
  }
}
