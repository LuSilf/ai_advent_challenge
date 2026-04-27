import { describe, test, expect } from "bun:test";
import { Hono } from "hono";
import { createAccessLogMiddleware, type AccessLogEntry, type AccessLogVars, type AccessLogFields } from "./access-log";

function buildApp(initialFields?: AccessLogFields) {
  const sink: AccessLogEntry[] = [];
  let t = 0;
  const advance = (ms: number) => {
    t += ms;
  };
  const app = new Hono<{ Variables: AccessLogVars }>();
  app.use("*", createAccessLogMiddleware((e) => sink.push(e), () => t));

  app.get("/health", (c) => c.json({ status: "ok" }, 200));

  app.get("/v1/work", async (c) => {
    c.set("keyId", "alice");
    advance(50);
    if (initialFields) c.set("logFields", initialFields);
    return c.json({ ok: true }, 200);
  });

  app.get("/v1/forbidden", (c) => {
    c.set("keyId", "-");
    return c.json({ error: "no" }, 401);
  });

  app.get("/v1/throws", () => {
    throw new Error("boom");
  });

  return { app, sink, advance };
}

describe("access-log middleware", () => {
  test("captures keyId, method, path, status, latency for happy path", async () => {
    const { app, sink } = buildApp({ model: "llama3.2:3b", inputTokens: 42, outputTokens: 13, stream: false });
    const r = await app.request("/v1/work");
    expect(r.status).toBe(200);
    expect(sink).toHaveLength(1);
    const e = sink[0];
    expect(e.keyId).toBe("alice");
    expect(e.method).toBe("GET");
    expect(e.path).toBe("/v1/work");
    expect(e.status).toBe(200);
    expect(e.latencyMs).toBe(50);
    expect(e.model).toBe("llama3.2:3b");
    expect(e.inputTokens).toBe(42);
    expect(e.outputTokens).toBe(13);
    expect(e.stream).toBe(false);
    expect(e.error).toBeNull();
    expect(e.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("anonymous keyId (e.g. /health) gets '-'", async () => {
    const { app, sink } = buildApp();
    await app.request("/health");
    expect(sink[0].keyId).toBe("-");
    expect(sink[0].path).toBe("/health");
    expect(sink[0].error).toBeNull();
  });

  test("401 path produces error: 'unauthorized'", async () => {
    const { app, sink } = buildApp();
    await app.request("/v1/forbidden");
    expect(sink[0].status).toBe(401);
    expect(sink[0].error).toBe("unauthorized");
  });

  test("explicit errorType from handler beats status mapping", async () => {
    const { app, sink } = buildApp({ errorType: "input_too_large", inputTokens: 10000 });
    const r = await app.request("/v1/work");
    expect(r.status).toBe(200);
    expect(sink[0].error).toBe("input_too_large");
    expect(sink[0].inputTokens).toBe(10000);
  });

  test("Hono-internal 500 (handler threw) → error 'internal_error'", async () => {
    const { app, sink } = buildApp();
    const r = await app.request("/v1/throws");
    expect(r.status).toBe(500);
    expect(sink).toHaveLength(1);
    expect(sink[0].status).toBe(500);
    expect(sink[0].error).toBe("internal_error");
  });

  test("each request produces exactly one log entry", async () => {
    const { app, sink } = buildApp({ model: "m" });
    await app.request("/v1/work");
    await app.request("/v1/work");
    await app.request("/v1/work");
    expect(sink).toHaveLength(3);
  });
});
