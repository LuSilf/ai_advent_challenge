import type { McpServerConfig } from "../../domain/models";
import type { McpServerRepository } from "../../domain/ports/mcp-server-repository";
import { getDb } from "../../db";

type McpServerRow = {
  name: string;
  command: string;
  args: string;
};

export class SqliteMcpServerRepository implements McpServerRepository {
  add(config: McpServerConfig): void {
    const db = getDb();
    db.run(
      "INSERT INTO mcp_servers (name, command, args) VALUES (?, ?, ?)",
      [config.name, config.command, JSON.stringify(config.args)],
    );
  }

  get(name: string): McpServerConfig | null {
    const db = getDb();
    const row = db.query<McpServerRow, [string]>(
      "SELECT name, command, args FROM mcp_servers WHERE name = ?",
    ).get(name);
    if (!row) return null;
    return { name: row.name, command: row.command, args: JSON.parse(row.args) };
  }

  getAll(): McpServerConfig[] {
    const db = getDb();
    return db.query<McpServerRow, []>(
      "SELECT name, command, args FROM mcp_servers ORDER BY name ASC",
    ).all().map((row) => ({
      name: row.name,
      command: row.command,
      args: JSON.parse(row.args),
    }));
  }

  remove(name: string): boolean {
    const db = getDb();
    const result = db.run("DELETE FROM mcp_servers WHERE name = ?", [name]);
    return result.changes > 0;
  }
}
