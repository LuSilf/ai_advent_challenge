import { loadServerConfig } from "./presentation/http/server-config";
import { OllamaProxy } from "./presentation/http/proxy/ollama-proxy";
import { createServer } from "./presentation/http/server";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const config = loadServerConfig((name) => process.env[name], fail);
const proxy = new OllamaProxy({ baseUrl: config.ollamaBaseUrl, timeoutMs: config.requestTimeoutMs });
const app = createServer({ config, proxy });

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  fetch: app.fetch,
  idleTimeout: 255,
});

const shutdown = (signal: string) => {
  console.log(`[server] received ${signal}, stopping…`);
  server.stop();
  process.exit(0);
};

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

console.log(`[server] listening on http://${config.host}:${config.port}`);
console.log(`[server] proxying to Ollama at ${config.ollamaBaseUrl} (timeout=${config.requestTimeoutMs}ms)`);
