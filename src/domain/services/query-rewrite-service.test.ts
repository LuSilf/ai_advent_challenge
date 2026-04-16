import { describe, test, expect } from "bun:test";
import { QueryRewriteService } from "./query-rewrite-service";

describe("QueryRewriteService", () => {
  test("returns rewritten query from LLM", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ message: { content: "Expanded technical query about caching strategies and patterns" } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );

    try {
      const service = new QueryRewriteService({ baseUrl: "http://localhost:11434", model: "test" });
      const result = await service.rewrite("what is caching?");
      expect(result).toBe("Expanded technical query about caching strategies and patterns");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("falls back to original query on HTTP error", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("error", { status: 500 });

    try {
      const service = new QueryRewriteService({ baseUrl: "http://localhost:11434", model: "test" });
      const result = await service.rewrite("what is caching?");
      expect(result).toBe("what is caching?");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("falls back to original query on network error", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("network error");
    };

    try {
      const service = new QueryRewriteService({ baseUrl: "http://localhost:11434", model: "test" });
      const result = await service.rewrite("what is caching?");
      expect(result).toBe("what is caching?");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("falls back to original query on empty response", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ message: { content: "" } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );

    try {
      const service = new QueryRewriteService({ baseUrl: "http://localhost:11434", model: "test" });
      const result = await service.rewrite("what is caching?");
      expect(result).toBe("what is caching?");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
