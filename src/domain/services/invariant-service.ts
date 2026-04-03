import type { Invariant } from "../models";
import type { InvariantRepository } from "../ports/invariant-repository";

export class InvariantService {
  constructor(private readonly invariantRepo: InvariantRepository) {}

  add(profileId: number, content: string): Invariant {
    const id = this.invariantRepo.add(profileId, content);
    return { id, profileId, content, createdAt: new Date().toISOString() };
  }

  getByProfile(profileId: number): Invariant[] {
    return this.invariantRepo.getByProfile(profileId);
  }

  delete(id: number): boolean {
    return this.invariantRepo.delete(id);
  }

  buildInvariantsBlock(profileId: number): string | null {
    const invariants = this.invariantRepo.getByProfile(profileId);
    if (invariants.length === 0) return null;

    const lines = [
      "=== ИНВАРИАНТЫ (нарушение запрещено) ===",
      "Ты ОБЯЗАН соблюдать следующие инварианты. Перед каждым ответом проверяй, не нарушает ли он какой-либо инвариант.",
      "Если запрос пользователя противоречит любому из них — ОТКАЖИ и объясни, какой именно инвариант будет нарушен и почему.",
      "",
    ];

    for (let i = 0; i < invariants.length; i++) {
      lines.push(`${i + 1}. ${invariants[i].content}`);
    }

    lines.push("");
    lines.push("=========================================");
    return lines.join("\n");
  }
}
