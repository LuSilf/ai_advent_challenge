import { loadConfig } from "./config";
import {
  printOutputMarker,
  printRequestDebug,
  printResponseDebug,
} from "./debug-logger";
import { loadDotEnv } from "./env";
import {
  getHttpStatus,
  isTimeoutError,
  runResponseRequest,
} from "./request-runner";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

await loadDotEnv();
const config = loadConfig(Bun.argv.slice(2).join(" "), fail);

if (config.debug) {
  printRequestDebug(config);
  printOutputMarker();
}

try {
  let hasOutput = false;
  let wroteOutputNewline = false;

  const result = await runResponseRequest(config, {
    onOutputTextDelta(delta) {
      process.stdout.write(delta);
      hasOutput = true;
    },
  });

  if (!hasOutput) {
    fail("No text content found in model response");
  }

  if (config.debug && result.response) {
    process.stdout.write("\n");
    wroteOutputNewline = true;
    printResponseDebug(
      result.response,
      result.startedAtMs,
      result.reasoningSummaryParts,
    );
  }

  if (!wroteOutputNewline) {
    process.stdout.write("\n");
  }
  process.exit(0);
} catch (error) {
  const status = getHttpStatus(error);

  if (isTimeoutError(error)) {
    console.error(`Request timed out after ${config.effectiveTimeoutMs}ms`);
    console.error("Check OPENAI_BASE_URL and network connectivity");
    process.exit(1);
  }

  if (status === 429) {
    console.error("Rate limit reached (HTTP 429)");
    console.error("Switch model/provider or wait before the next request");
    console.error("Also check account quota/credits on the provider side");
    process.exit(1);
  }

  console.error("LLM request failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
