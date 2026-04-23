import { describe, test, expect } from "bun:test";
import { WhitelistGuard } from "./whitelist";

describe("WhitelistGuard", () => {
  test("parses valid CSV of chat_ids", () => {
    const g = new WhitelistGuard("123,456,789");
    expect(g.size).toBe(3);
    expect(g.isAllowed(123)).toBe(true);
    expect(g.isAllowed(456)).toBe(true);
    expect(g.isAllowed(789)).toBe(true);
  });

  test("denies chat_id not in list", () => {
    const g = new WhitelistGuard("123");
    expect(g.isAllowed(124)).toBe(false);
    expect(g.isAllowed(0)).toBe(false);
  });

  test("tolerates surrounding whitespace", () => {
    const g = new WhitelistGuard(" 123 ,\t456 , 789 ");
    expect(g.size).toBe(3);
    expect(g.isAllowed(123)).toBe(true);
    expect(g.isAllowed(456)).toBe(true);
  });

  test("deduplicates entries", () => {
    const g = new WhitelistGuard("42,42,42");
    expect(g.size).toBe(1);
    expect(g.isAllowed(42)).toBe(true);
  });

  test("ignores empty tokens", () => {
    const g = new WhitelistGuard("123,,456,");
    expect(g.size).toBe(2);
    expect(g.isAllowed(123)).toBe(true);
    expect(g.isAllowed(456)).toBe(true);
  });

  test("accepts negative chat_id (Telegram groups)", () => {
    const g = new WhitelistGuard("-100200,456");
    expect(g.size).toBe(2);
    expect(g.isAllowed(-100200)).toBe(true);
  });

  test("throws on non-integer tokens", () => {
    expect(() => new WhitelistGuard("123,abc")).toThrow(/Invalid chat_id/);
    expect(() => new WhitelistGuard("12.5")).toThrow(/Invalid chat_id/);
  });

  test("empty string yields empty guard", () => {
    const g = new WhitelistGuard("");
    expect(g.size).toBe(0);
    expect(g.isAllowed(1)).toBe(false);
  });
});
