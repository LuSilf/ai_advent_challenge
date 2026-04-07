import type { McpServerConfig } from "../models";

export interface McpServerRepository {
  add(config: McpServerConfig): void;
  get(name: string): McpServerConfig | null;
  getAll(): McpServerConfig[];
  remove(name: string): boolean;
}
