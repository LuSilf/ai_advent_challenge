export interface CheckpointRepository {
  create(sessionId: number): number;
  getLastBySession(sessionId: number): { id: number; messageId: number } | null;
}
