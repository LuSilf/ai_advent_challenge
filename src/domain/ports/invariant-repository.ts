import type { Invariant } from "../models";

export interface InvariantRepository {
  add(profileId: number, content: string): number;
  getByProfile(profileId: number): Invariant[];
  delete(id: number): boolean;
}
