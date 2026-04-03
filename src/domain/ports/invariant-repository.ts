import type { Invariant } from "../models";

export interface InvariantRepository {
  add(content: string): number;
  getAll(): Invariant[];
  delete(id: number): boolean;
}
