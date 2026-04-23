export class WhitelistGuard {
  private readonly allowed: Set<number>;

  constructor(csv: string) {
    this.allowed = new Set();
    for (const raw of csv.split(",")) {
      const token = raw.trim();
      if (!token) continue;
      const parsed = Number(token);
      if (!Number.isInteger(parsed)) {
        throw new Error(`Invalid chat_id in whitelist: ${JSON.stringify(token)}. Expected integer.`);
      }
      this.allowed.add(parsed);
    }
  }

  isAllowed(chatId: number): boolean {
    return this.allowed.has(chatId);
  }

  get size(): number {
    return this.allowed.size;
  }
}
