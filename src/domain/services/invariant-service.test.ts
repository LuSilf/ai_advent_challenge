import { describe, test, expect, beforeEach } from "bun:test";
import { InvariantService } from "./invariant-service";
import type { InvariantRepository } from "../ports/invariant-repository";
import type { Invariant } from "../models";

function createMockRepo(): InvariantRepository & { invariants: Invariant[] } {
  const invariants: Invariant[] = [];
  let nextId = 1;
  return {
    invariants,
    add(profileId, content) {
      const id = nextId++;
      invariants.push({ id, profileId, content, createdAt: new Date().toISOString() });
      return id;
    },
    getByProfile(profileId) {
      return invariants.filter((i) => i.profileId === profileId);
    },
    delete(id) {
      const idx = invariants.findIndex((i) => i.id === id);
      if (idx === -1) return false;
      invariants.splice(idx, 1);
      return true;
    },
  };
}

describe("InvariantService", () => {
  let service: InvariantService;
  let repo: ReturnType<typeof createMockRepo>;

  beforeEach(() => {
    repo = createMockRepo();
    service = new InvariantService(repo);
  });

  test("add creates invariant", () => {
    const inv = service.add(1, "Только REST API");
    expect(inv.id).toBe(1);
    expect(inv.content).toBe("Только REST API");
    expect(inv.profileId).toBe(1);
  });

  test("getByProfile returns invariants", () => {
    service.add(1, "правило 1");
    service.add(1, "правило 2");
    service.add(2, "другой профиль");

    expect(service.getByProfile(1)).toHaveLength(2);
    expect(service.getByProfile(2)).toHaveLength(1);
  });

  test("delete removes invariant", () => {
    const inv = service.add(1, "правило");
    expect(service.delete(inv.id)).toBe(true);
    expect(service.getByProfile(1)).toHaveLength(0);
  });

  test("buildInvariantsBlock returns null for empty list", () => {
    expect(service.buildInvariantsBlock(1)).toBeNull();
  });

  test("buildInvariantsBlock formats invariants", () => {
    service.add(1, "Только TypeScript");
    service.add(1, "Архитектура: hexagonal");

    const block = service.buildInvariantsBlock(1);
    expect(block).not.toBeNull();
    expect(block).toContain("ИНВАРИАНТЫ");
    expect(block).toContain("1. Только TypeScript");
    expect(block).toContain("2. Архитектура: hexagonal");
    expect(block).toContain("ОТКАЖИ");
  });
});
