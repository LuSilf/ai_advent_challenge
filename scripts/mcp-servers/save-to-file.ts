import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { resolve } from "node:path";

const server = new McpServer({
  name: "save-to-file",
  version: "1.0.0",
});

function isValidFilename(filename: string): boolean {
  if (!filename || filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return false;
  }
  // Only allow simple filenames with common extensions
  return /^[\w\-. ]+$/.test(filename);
}

server.tool(
  "save_to_file",
  "Сохраняет текстовый контент в файл в текущей рабочей директории. Подходит для сохранения Markdown-отчётов, суммари и других текстовых данных.",
  {
    filename: z.string().describe("Имя файла, например 'spring-boot-summary.md'. Только имя файла, без путей."),
    content: z.string().describe("Текстовый контент для записи в файл (Markdown, plain text и т.д.)"),
  },
  async ({ filename, content }) => {
    if (!isValidFilename(filename)) {
      return {
        content: [{ type: "text", text: `Ошибка: недопустимое имя файла '${filename}'. Используйте только имя файла без путей и спецсимволов.` }],
        isError: true,
      };
    }

    if (!content.trim()) {
      return {
        content: [{ type: "text", text: "Ошибка: пустой контент для записи" }],
        isError: true,
      };
    }

    try {
      const filePath = resolve(process.cwd(), filename);
      await Bun.write(filePath, content);
      return {
        content: [{ type: "text", text: `Файл сохранён: ${filePath}` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Ошибка записи файла: ${(error as Error).message}` }],
        isError: true,
      };
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
