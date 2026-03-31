import type { Option } from "../models";

export interface OptionsRepository {
  get(key: string): string | null;
  set(key: string, value: string): void;
  getAll(): Option[];
}
