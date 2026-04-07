import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpServerConfig, McpTool } from "../models";

export class McpClientService {
  async listTools(config: McpServerConfig): Promise<McpTool[]> {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      stderr: "pipe",
      cwd: config.cwd,
    });

    const client = new Client({ name: "cli-chatbot", version: "1.0.0" });

    try {
      await client.connect(transport);
      const result = await client.listTools();
      return result.tools.map((t) => ({
        name: t.name,
        description: t.description ?? "",
        inputSchema: t.inputSchema,
      }));
    } finally {
      await client.close();
    }
  }
}
