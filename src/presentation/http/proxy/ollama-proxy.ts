export type OllamaProxyOptions = {
  baseUrl: string;
  timeoutMs: number;
};

export type ProxyResult =
  | { kind: "json"; status: number; body: unknown }
  | { kind: "stream"; status: number; body: ReadableStream<Uint8Array>; contentType: string }
  | { kind: "error"; status: number; message: string };

export class OllamaProxy {
  constructor(private readonly opts: OllamaProxyOptions) {}

  async chatCompletions(payload: unknown, stream: boolean): Promise<ProxyResult> {
    const url = `${this.opts.baseUrl}/v1/chat/completions`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    try {
      const upstream = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (stream) {
        if (!upstream.body) {
          clearTimeout(timer);
          return { kind: "error", status: 502, message: "Upstream Ollama did not return a body" };
        }
        // Pass-through stream; Hono will close it. Defer timer cleanup until stream ends.
        const wrapped = upstream.body.pipeThrough(
          new TransformStream({
            flush() {
              clearTimeout(timer);
            },
          }),
        );
        return {
          kind: "stream",
          status: upstream.status,
          body: wrapped,
          contentType: upstream.headers.get("Content-Type") ?? "text/event-stream",
        };
      }

      const text = await upstream.text();
      clearTimeout(timer);
      try {
        return { kind: "json", status: upstream.status, body: JSON.parse(text) };
      } catch {
        return { kind: "json", status: upstream.status, body: { raw: text } };
      }
    } catch (err) {
      clearTimeout(timer);
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("aborted") || message.includes("timeout")) {
        return { kind: "error", status: 504, message: `Upstream Ollama timeout after ${this.opts.timeoutMs}ms` };
      }
      return { kind: "error", status: 502, message: `Upstream Ollama error: ${message}` };
    }
  }

  async ping(): Promise<{ ok: boolean; models?: string[] }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    try {
      const r = await fetch(`${this.opts.baseUrl}/api/tags`, { signal: controller.signal });
      clearTimeout(timer);
      if (!r.ok) return { ok: false };
      const data = (await r.json()) as { models?: Array<{ name: string }> };
      return { ok: true, models: (data.models ?? []).map((m) => m.name) };
    } catch {
      clearTimeout(timer);
      return { ok: false };
    }
  }
}
