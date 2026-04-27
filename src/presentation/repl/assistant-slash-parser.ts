export type AssistantCommand =
  | { kind: "help"; question: string }
  | { kind: "reindex" }
  | { kind: "tools" }
  | { kind: "clear" }
  | { kind: "quit" }
  | { kind: "error"; message: string };

const HINT = "Команды должны начинаться со /. Попробуйте: /help <вопрос>, /reindex, /tools, /clear, /quit.";

export function parseAssistantCommand(input: string): AssistantCommand | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  if (!trimmed.startsWith("/")) {
    return { kind: "error", message: HINT };
  }

  const spaceIdx = trimmed.indexOf(" ");
  const head = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
  const rest = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();

  switch (head) {
    case "/help": {
      if (rest.length === 0) {
        return { kind: "error", message: "/help требует вопрос: /help <вопрос>" };
      }
      return { kind: "help", question: rest };
    }
    case "/reindex":
      return { kind: "reindex" };
    case "/tools":
      return { kind: "tools" };
    case "/clear":
      return { kind: "clear" };
    case "/quit":
    case "/exit":
      return { kind: "quit" };
    default:
      return { kind: "error", message: `Неизвестная команда: ${head}. ${HINT}` };
  }
}
