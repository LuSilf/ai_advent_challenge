import { Hono } from "hono";
import type { ServerConfig } from "./server-config";
import { OllamaProxy } from "./proxy/ollama-proxy";
import { ApiKeyAuth } from "./auth/api-key-auth";
import { RateLimiter } from "./rate-limit/rate-limiter";

export type ServerDeps = {
  config: ServerConfig;
  proxy: OllamaProxy;
  auth: ApiKeyAuth;
  rateLimiter: RateLimiter;
};

type AuthVars = { keyId: string };

export function createServer(deps: ServerDeps): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();

  app.get("/health", async (c) => {
    const ping = await deps.proxy.ping();
    if (!ping.ok) {
      return c.json({ status: "degraded", ollama: "down" }, 503);
    }
    return c.json({ status: "ok", ollama: "up", models: ping.models ?? [] }, 200);
  });

  app.use("/v1/*", async (c, next) => {
    const result = deps.auth.authenticate(c.req.header("Authorization"));
    if (!result) {
      return c.json({ error: { message: "Unauthorized: missing or invalid Bearer token", type: "unauthorized" } }, 401);
    }
    c.set("keyId", result.keyId);
    await next();
  });

  app.use("/v1/*", async (c, next) => {
    const decision = deps.rateLimiter.tryConsume(c.get("keyId"));
    if (!decision.ok) {
      const retryAfterSec = Math.ceil(decision.retryAfterMs / 1000);
      c.header("Retry-After", String(Math.max(1, retryAfterSec)));
      return c.json(
        {
          error: { message: "Rate limit exceeded", type: "rate_limit", retryAfterMs: decision.retryAfterMs },
        },
        429,
      );
    }
    await next();
  });

  app.get("/v1/models", (c) => {
    const data = deps.config.allowedModels.map((id) => ({
      id,
      object: "model",
      owned_by: "local",
    }));
    return c.json({ object: "list", data }, 200);
  });

  app.post("/v1/chat/completions", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: { message: "Invalid JSON body", type: "bad_request" } }, 400);
    }

    const stream = body.stream === true;
    const result = await deps.proxy.chatCompletions(body, stream);

    if (result.kind === "error") {
      return c.json({ error: { message: result.message, type: "upstream_error" } }, result.status as 502 | 504);
    }

    if (result.kind === "stream") {
      return new Response(result.body, {
        status: result.status,
        headers: {
          "Content-Type": result.contentType,
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    return c.json(result.body as object, result.status as 200);
  });

  return app;
}
