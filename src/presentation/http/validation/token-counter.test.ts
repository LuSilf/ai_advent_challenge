import { describe, test, expect } from "bun:test";
import { TokenCounter, MESSAGE_OVERHEAD_TOKENS, REPLY_PRIMER_TOKENS } from "./token-counter";

describe("TokenCounter", () => {
  const counter = new TokenCounter();

  test("empty messages returns reply primer overhead only", () => {
    expect(counter.countMessages([])).toBe(REPLY_PRIMER_TOKENS);
  });

  test("single short message", () => {
    const got = counter.countMessages([{ role: "user", content: "hello" }]);
    expect(got).toBeGreaterThan(MESSAGE_OVERHEAD_TOKENS);
    expect(got).toBeLessThan(MESSAGE_OVERHEAD_TOKENS + 10);
  });

  test("multi-message sums per-message overhead", () => {
    const a = counter.countMessages([{ role: "user", content: "hi" }]);
    const b = counter.countMessages([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hi" },
    ]);
    expect(b - a).toBeGreaterThanOrEqual(MESSAGE_OVERHEAD_TOKENS + 1);
  });

  test("does not throw on cyrillic", () => {
    const got = counter.countMessages([{ role: "user", content: "Привет, как дела?" }]);
    expect(got).toBeGreaterThan(REPLY_PRIMER_TOKENS);
  });

  test("does not throw on emoji", () => {
    const got = counter.countMessages([{ role: "user", content: "🚀🔥💯" }]);
    expect(got).toBeGreaterThan(REPLY_PRIMER_TOKENS);
  });

  test("known long string reaches order of magnitude expected for cl100k", () => {
    const content = "x ".repeat(10_000);
    const got = counter.countMessages([{ role: "user", content }]);
    expect(got).toBeGreaterThan(5_000);
    expect(got).toBeLessThan(15_000);
  });

  test("ignores undefined content gracefully", () => {
    const got = counter.countMessages([{ role: "user", content: undefined as unknown as string }]);
    // overhead (4) + role token(s) for "user" + reply primer (2). Should NOT throw.
    expect(got).toBeGreaterThanOrEqual(MESSAGE_OVERHEAD_TOKENS + REPLY_PRIMER_TOKENS);
    expect(got).toBeLessThan(MESSAGE_OVERHEAD_TOKENS + REPLY_PRIMER_TOKENS + 5);
  });

  test("countMessages is deterministic for same input", () => {
    const msgs = [{ role: "user", content: "snapshot determinism check" }];
    expect(counter.countMessages(msgs)).toBe(counter.countMessages(msgs));
  });
});
