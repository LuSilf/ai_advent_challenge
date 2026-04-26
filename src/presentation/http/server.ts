import { Hono } from "hono";
import type { ServerConfig } from "./server-config";
import { OllamaProxy } from "./proxy/ollama-proxy";

export type ServerDeps = {
  config: ServerConfig;
  proxy: OllamaProxy;
};

export function createServer(deps: ServerDeps): Hono {
  const app = new Hono();

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
