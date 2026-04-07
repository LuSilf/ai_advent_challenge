import pc from "picocolors";
import type { ToolCallEvent } from "../../domain/services/chat-service";

export function formatToolCallStart(event: ToolCallEvent): string {
  const lines: string[] = [];

  lines.push(pc.yellow(`🔧 Вызов инструмента: ${pc.bold(event.toolName)}`));
  if (event.serverName) {
    lines.push(pc.dim(`   Сервер: ${event.serverName}`));
  }
  if (event.description) {
    lines.push(pc.dim(`   Описание: ${event.description}`));
  }
  const argsStr = Object.keys(event.arguments).length > 0
    ? JSON.stringify(event.arguments, null, 2).split("\n").map((l, i) => i === 0 ? l : `   ${l}`).join("\n")
    : "{}";
  lines.push(pc.dim(`   Параметры: ${argsStr}`));
  lines.push(pc.dim("   ─────────────────"));

  return lines.join("\n");
}

export function formatToolCallResult(event: ToolCallEvent): string {
  if (event.result === undefined) return "";

  const lines: string[] = [];

  if (event.isError) {
    lines.push(pc.red(`   Ошибка: ${event.result}`));
  } else {
    const resultLines = event.result.split("\n");
    if (resultLines.length <= 5) {
      lines.push(pc.green(`   Результат: ${resultLines[0]}`));
      for (let i = 1; i < resultLines.length; i++) {
        lines.push(pc.green(`   ${resultLines[i]}`));
      }
    } else {
      // Truncate long results
      for (let i = 0; i < 4; i++) {
        lines.push(pc.green(`   ${i === 0 ? "Результат: " : ""}${resultLines[i]}`));
      }
      lines.push(pc.dim(`   ... (ещё ${resultLines.length - 4} строк)`));
    }
  }

  lines.push(""); // Empty line after result

  return lines.join("\n");
}

export function formatToolCall(event: ToolCallEvent): string {
  if (event.result !== undefined) {
    return formatToolCallResult(event);
  }
  return formatToolCallStart(event);
}
