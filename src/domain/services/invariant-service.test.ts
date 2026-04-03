import { describe, test, expect, beforeEach } from "bun:test";
import { InvariantService } from "./invariant-service";
import type { InvariantRepository } from "../ports/invariant-repository";
import type { Invariant } from "../models";

function createMockRepo(): InvariantRepository & { invariants: Invariant[] } {
  const invariants: Invariant[] = [];
  let nextId = 1;
  return {
    invariants,
    add(content) {
      const id = nextId++;
      invariants.push({ id, content, createdAt: new Date().toISOString() });
      return id;
    },
    getAll() {
      return [...invariants];
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
    const inv = service.add("Только REST API");
    expect(inv.id).toBe(1);
    expect(inv.content).toBe("Только REST API");
  });

  test("getAll returns invariants", () => {
    service.add("правило 1");
    service.add("правило 2");
    expect(service.getAll()).toHaveLength(2);
  });

  test("delete removes invariant", () => {
    const inv = service.add("правило");
    expect(service.delete(inv.id)).toBe(true);
    expect(service.getAll()).toHaveLength(0);
  });

  test("buildInvariantsBlock returns null for empty list", () => {
    expect(service.buildInvariantsBlock()).toBeNull();
  });

  test("buildInvariantsBlock formats invariants", () => {
    service.add("Только TypeScript");
    service.add("Архитектура: hexagonal");

    const block = service.buildInvariantsBlock();
    expect(block).not.toBeNull();
    expect(block).toContain("ИНВАРИАНТЫ");
    expect(block).toContain("1. Только TypeScript");
    expect(block).toContain("2. Архитектура: hexagonal");
    expect(block).toContain("ОТКАЖИ");
  });
});
