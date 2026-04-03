import type { Invariant } from "../models";
import type { InvariantRepository } from "../ports/invariant-repository";

export class InvariantService {
  constructor(private readonly invariantRepo: InvariantRepository) {}

  add(content: string): Invariant {
    const id = this.invariantRepo.add(content);
    return { id, content, createdAt: new Date().toISOString() };
  }

  getAll(): Invariant[] {
    return this.invariantRepo.getAll();
  }

  delete(id: number): boolean {
    return this.invariantRepo.delete(id);
  }

  buildInvariantsBlock(): string | null {
    const invariants = this.invariantRepo.getAll();
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
