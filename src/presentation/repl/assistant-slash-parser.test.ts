import { describe, test, expect } from "bun:test";
import { parseAssistantCommand } from "./assistant-slash-parser";

describe("parseAssistantCommand", () => {
  test("returns null for empty input", () => {
    expect(parseAssistantCommand("")).toBeNull();
    expect(parseAssistantCommand("   ")).toBeNull();
    expect(parseAssistantCommand("\t\n")).toBeNull();
  });

  test("parses /help with question", () => {
    expect(parseAssistantCommand("/help как устроен RAG?")).toEqual({
      kind: "help",
      question: "как устроен RAG?",
    });
  });

  test("trims surrounding whitespace and inner question whitespace", () => {
    expect(parseAssistantCommand("  /help   что в src/   ")).toEqual({
      kind: "help",
      question: "что в src/",
    });
  });

  test("/help without argument is an error", () => {
    const result = parseAssistantCommand("/help");
    expect(result?.kind).toBe("error");
    if (result?.kind === "error") {
      expect(result.message).toContain("/help");
    }
  });

  test("/help with whitespace-only argument is an error", () => {
    const result = parseAssistantCommand("/help    ");
    expect(result?.kind).toBe("error");
  });

  test("parses /reindex", () => {
    expect(parseAssistantCommand("/reindex")).toEqual({ kind: "reindex" });
  });

  test("/reindex ignores trailing arguments", () => {
    expect(parseAssistantCommand("/reindex now please")).toEqual({ kind: "reindex" });
  });

  test("parses /tools", () => {
    expect(parseAssistantCommand("/tools")).toEqual({ kind: "tools" });
  });

  test("parses /clear", () => {
    expect(parseAssistantCommand("/clear")).toEqual({ kind: "clear" });
  });

  test("parses /quit and /exit as quit", () => {
    expect(parseAssistantCommand("/quit")).toEqual({ kind: "quit" });
    expect(parseAssistantCommand("/exit")).toEqual({ kind: "quit" });
  });

  test("unknown slash command is an error", () => {
    const result = parseAssistantCommand("/foo");
    expect(result?.kind).toBe("error");
    if (result?.kind === "error") {
      expect(result.message).toContain("/foo");
    }
  });

  test("non-slash input is an error with hint", () => {
    const result = parseAssistantCommand("привет");
    expect(result?.kind).toBe("error");
    if (result?.kind === "error") {
      expect(result.message).toContain("/help");
    }
  });

  test("commands are case-sensitive (lowercase only)", () => {
    expect(parseAssistantCommand("/HELP foo")?.kind).toBe("error");
    expect(parseAssistantCommand("/Quit")?.kind).toBe("error");
  });
});
