import type { Context, MiddlewareHandler } from "hono";

export type AccessLogFields = {
  model?: string;
  inputTokens?: number;
  outputTokens?: number | null;
  stream?: boolean;
  errorType?: string;
};

export type AccessLogEntry = {
  ts: string;
  keyId: string;
  method: string;
  path: string;
  status: number;
  latencyMs: number;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  stream: boolean | null;
  error: string | null;
};

export type AccessLogVars = {
  keyId?: string;
  logFields?: AccessLogFields;
};

export type LogSink = (entry: AccessLogEntry) => void;

export function defaultLogSink(entry: AccessLogEntry): void {
  process.stdout.write(JSON.stringify(entry) + "\n");
}

export function createAccessLogMiddleware(
  sink: LogSink = defaultLogSink,
  now: () => number = () => performance.now(),
): MiddlewareHandler<{ Variables: AccessLogVars }> {
  return async (c, next) => {
    const start = now();
    await next();
    const status = c.res.status;
    const fields = c.get("logFields") as AccessLogFields | undefined;
    const errorType = fields?.errorType ?? errorMatchFromStatus(status);
    const latencyMs = Math.round(now() - start);
    writeEntry(c, sink, status, latencyMs, errorType);
  };
}

function writeEntry(
  c: Context<{ Variables: AccessLogVars }>,
  sink: LogSink,
  status: number,
  latencyMs: number,
  errorType: string | null,
): void {
  const fields = (c.get("logFields") as AccessLogFields | undefined) ?? {};
  const entry: AccessLogEntry = {
    ts: new Date().toISOString(),
    keyId: c.get("keyId") ?? "-",
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    status,
    latencyMs,
    model: fields.model ?? null,
    inputTokens: fields.inputTokens ?? null,
    outputTokens: fields.outputTokens ?? null,
    stream: typeof fields.stream === "boolean" ? fields.stream : null,
    error: errorType,
  };
  sink(entry);
}

function errorMatchFromStatus(status: number): string | null {
  if (status === 401) return "unauthorized";
  if (status === 429) return "rate_limit";
  if (status === 413) return "input_too_large";
  if (status === 400) return "bad_request";
  if (status === 502) return "upstream_error";
  if (status === 503) return "ollama_down";
  if (status === 504) return "upstream_timeout";
  if (status >= 500) return "internal_error";
  return null;
}
