import type { McpServerConfig, McpTool, ToolWithServer, ConnectionStatus } from "../models";
import type { McpServerRepository } from "../ports/mcp-server-repository";
import { McpClientService, type McpConnection, type McpToolCallResult } from "./mcp-client-service";

type ServerEntry = {
  config: McpServerConfig;
  connection: McpConnection | null;
  status: ConnectionStatus["status"];
  error?: string;
  tools: McpTool[];
};

export class McpConnectionManager {
  private servers = new Map<string, ServerEntry>();

  constructor(
    private readonly mcpServerRepo: McpServerRepository,
    private readonly mcpClientService: McpClientService,
  ) {}

  async connectAll(): Promise<ConnectionStatus[]> {
    const configs = this.mcpServerRepo.getAll();
    const results: ConnectionStatus[] = [];

    for (const config of configs) {
      const status = await this._connectOne(config);
      results.push(status);
    }

    return results;
  }

  async connectOne(config: McpServerConfig): Promise<[ConnectionStatus]> {
    const status = await this._connectOne(config);
    return [status];
  }

  private async _connectOne(config: McpServerConfig): Promise<ConnectionStatus> {
    try {
      const connection = await this.mcpClientService.connect(config);
      const tools = await this.mcpClientService.listToolsFromConnection(connection);

      this.servers.set(config.name, {
        config,
        connection,
        status: "connected",
        tools,
      });

      return {
        serverName: config.name,
        status: "connected",
        toolCount: tools.length,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);

      this.servers.set(config.name, {
        config,
        connection: null,
        status: "error",
        error,
        tools: [],
      });

      return {
        serverName: config.name,
        status: "error",
        error,
      };
    }
  }

  getAvailableTools(): ToolWithServer[] {
    const result: ToolWithServer[] = [];

    for (const [serverName, entry] of this.servers) {
      if (entry.status !== "connected") continue;
      for (const tool of entry.tools) {
        result.push({ ...tool, serverName });
      }
    }

    return result;
  }

  getStatuses(): ConnectionStatus[] {
    return [...this.servers.entries()].map(([serverName, entry]) => ({
      serverName,
      status: entry.status,
      error: entry.error,
      toolCount: entry.tools.length,
    }));
  }

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpToolCallResult> {
    const entry = this.servers.get(serverName);
    if (!entry) {
      return { content: `Сервер "${serverName}" не найден`, isError: true };
    }

    if (entry.status !== "connected" || !entry.connection) {
      // Retry: попытка переподключиться
      const reconnected = await this.tryReconnect(entry);
      if (!reconnected) {
        return { content: `Сервер "${serverName}" недоступен: ${entry.error ?? "нет соединения"}`, isError: true };
      }
    }

    try {
      return await this.mcpClientService.callTool(entry.connection!, toolName, args);
    } catch (err) {
      // Транспортная ошибка — один retry с переподключением
      const reconnected = await this.tryReconnect(entry);
      if (!reconnected) {
        const error = err instanceof Error ? err.message : String(err);
        return { content: `Ошибка вызова ${toolName}: ${error}`, isError: true };
      }

      try {
        return await this.mcpClientService.callTool(entry.connection!, toolName, args);
      } catch (retryErr) {
        const error = retryErr instanceof Error ? retryErr.message : String(retryErr);
        return { content: `Ошибка вызова ${toolName} после retry: ${error}`, isError: true };
      }
    }
  }

  private async tryReconnect(entry: ServerEntry): Promise<boolean> {
    try {
      // Закрыть старое соединение если есть
      if (entry.connection) {
        try {
          await this.mcpClientService.disconnect(entry.connection);
        } catch {
          // ignore
        }
      }

      const connection = await this.mcpClientService.connect(entry.config);
      const tools = await this.mcpClientService.listToolsFromConnection(connection);

      entry.connection = connection;
      entry.status = "connected";
      entry.error = undefined;
      entry.tools = tools;

      return true;
    } catch (err) {
      entry.connection = null;
      entry.status = "error";
      entry.error = err instanceof Error ? err.message : String(err);
      entry.tools = [];
      return false;
    }
  }

  async disconnectOne(serverName: string): Promise<void> {
    const entry = this.servers.get(serverName);
    if (!entry) return;

    if (entry.connection) {
      try {
        await this.mcpClientService.disconnect(entry.connection);
      } catch {
        // ignore
      }
    }
    this.servers.delete(serverName);
  }

  async disconnectAll(): Promise<void> {
    for (const [, entry] of this.servers) {
      if (entry.connection) {
        try {
          await this.mcpClientService.disconnect(entry.connection);
        } catch {
          // ignore on shutdown
        }
        entry.connection = null;
        entry.status = "disconnected";
      }
    }
    this.servers.clear();
  }
}
