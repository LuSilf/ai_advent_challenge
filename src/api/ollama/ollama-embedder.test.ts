import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { OllamaEmbedder } from "./ollama-embedder";

const DIM = 4;

type FetchCall = { url: string; init: RequestInit };

function mockFetch(
  handler: (call: FetchCall) => Response | Promise<Response>
): { calls: FetchCall[]; restore: () => void } {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.url;
    const call: FetchCall = { url, init: init ?? {} };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("OllamaEmbedder", () => {
  let restore: () => void = () => {};

  afterEach(() => {
    restore();
  });

  test("empty input returns empty array without hitting the network", async () => {
    const mock = mockFetch(() => new Response("should not be called", { status: 500 }));
    restore = mock.restore;

    const embedder = new OllamaEmbedder({ baseUrl: "http://localhost:11434", model: "bge-m3", dimension: DIM });
    const result = await embedder.embed([]);

    expect(result).toEqual([]);
    expect(mock.calls.length).toBe(0);
  });

  test("sends POST to /api/embed with model and input array", async () => {
    const mock = mockFetch(() =>
      jsonResponse({ model: "bge-m3", embeddings: [[1, 0, 0, 0], [0, 1, 0, 0]] })
    );
    restore = mock.restore;

    const embedder = new OllamaEmbedder({ baseUrl: "http://localhost:11434", model: "bge-m3", dimension: DIM });
    await embedder.embed(["hello", "world"]);

    expect(mock.calls.length).toBe(1);
    const call = mock.calls[0]!;
    expect(call.url).toBe("http://localhost:11434/api/embed");
    expect(call.init.method).toBe("POST");

    const body = JSON.parse(call.init.body as string);
    expect(body).toEqual({ model: "bge-m3", input: ["hello", "world"] });
  });

  test("trailing slash in baseUrl is normalized", async () => {
    const mock = mockFetch(() => jsonResponse({ model: "bge-m3", embeddings: [[1, 0, 0, 0]] }));
    restore = mock.restore;

    const embedder = new OllamaEmbedder({ baseUrl: "http://localhost:11434/", model: "bge-m3", dimension: DIM });
    await embedder.embed(["hi"]);

    expect(mock.calls[0]!.url).toBe("http://localhost:11434/api/embed");
  });

  test("parses response into Float32Array[] preserving order", async () => {
    const mock = mockFetch(() =>
      jsonResponse({ model: "bge-m3", embeddings: [[1, 0, 0, 0], [0, 0.5, 0, 0.5]] })
    );
    restore = mock.restore;

    const embedder = new OllamaEmbedder({ baseUrl: "http://localhost:11434", model: "bge-m3", dimension: DIM });
    const result = await embedder.embed(["a", "b"]);

    expect(result.length).toBe(2);
    expect(result[0]).toBeInstanceOf(Float32Array);
    expect(Array.from(result[0]!)).toEqual([1, 0, 0, 0]);
    expect(Array.from(result[1]!)).toEqual([0, 0.5, 0, 0.5]);
  });

  test("throws on HTTP error with status in message", async () => {
    const mock = mockFetch(() => new Response("model not found", { status: 404 }));
    restore = mock.restore;

    const embedder = new OllamaEmbedder({ baseUrl: "http://localhost:11434", model: "bge-m3", dimension: DIM });
    await expect(embedder.embed(["x"])).rejects.toThrow(/404/);
  });

  test("throws when embeddings count mismatches input count", async () => {
    const mock = mockFetch(() => jsonResponse({ model: "bge-m3", embeddings: [[1, 0, 0, 0]] }));
    restore = mock.restore;

    const embedder = new OllamaEmbedder({ baseUrl: "http://localhost:11434", model: "bge-m3", dimension: DIM });
    await expect(embedder.embed(["a", "b"])).rejects.toThrow(/1 embeddings for 2 inputs/);
  });

  test("throws when vector dimension does not match", async () => {
    const mock = mockFetch(() => jsonResponse({ model: "bge-m3", embeddings: [[1, 0, 0]] }));
    restore = mock.restore;

    const embedder = new OllamaEmbedder({ baseUrl: "http://localhost:11434", model: "bge-m3", dimension: DIM });
    await expect(embedder.embed(["x"])).rejects.toThrow(/dimension/);
  });

  test("exposes dimension from config", () => {
    const embedder = new OllamaEmbedder({ baseUrl: "http://localhost:11434", model: "bge-m3", dimension: 1024 });
    expect(embedder.dimension).toBe(1024);
  });
});
