import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpServerConfig, McpTool } from "../models";

export type McpConnection = {
  client: Client;
  transport: StdioClientTransport;
};

export type McpToolCallResult = {
  content: string;
  isError: boolean;
};

export class McpClientService {
  async connect(config: McpServerConfig): Promise<McpConnection> {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      stderr: "pipe",
      cwd: config.cwd,
    });

    const client = new Client({ name: "cli-chatbot", version: "1.0.0" });
    await client.connect(transport);

    return { client, transport };
  }

  async listTools(config: McpServerConfig): Promise<McpTool[]> {
    const conn = await this.connect(config);
    try {
      return await this.listToolsFromConnection(conn);
    } finally {
      await this.disconnect(conn);
    }
  }

  async listToolsFromConnection(conn: McpConnection): Promise<McpTool[]> {
    const result = await conn.client.listTools();
    return result.tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: t.inputSchema,
    }));
  }

  async callTool(
    conn: McpConnection,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpToolCallResult> {
    const result = await conn.client.callTool({ name: toolName, arguments: args });

    const text = (result.content as Array<{ type: string; text?: string }>)
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text!)
      .join("\n");

    return {
      content: text,
      isError: result.isError === true,
    };
  }

  async disconnect(conn: McpConnection): Promise<void> {
    await conn.client.close();
  }
}
