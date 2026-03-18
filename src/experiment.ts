import OpenAI from "openai";
import type { Response } from "openai/resources/responses/responses";
import pc from "picocolors";

type TaskCase = {
  id: string;
  prompt: string;
  expected?: number;
};

type MethodId = "direct" | "step_by_step" | "meta_prompt" | "experts";

type CallMetrics = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
};

type ReasoningSummaryMode = "auto" | "concise" | "detailed";

type CallTrace = {
  label: string;
  prompt: string;
  output: string;
  reasoningSummaries: string[];
  metrics: CallMetrics;
};

type MethodRun = {
  method: MethodId;
  taskId: string;
  expected?: number;
  output: string;
  parsedAnswer: number | null;
  isCorrect: boolean;
  apiCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
  estimatedCostUsd?: number;
  traces: CallTrace[];
};

type MethodSummary = {
  method: MethodId;
  correct: number;
  total: number;
  accuracyPct: number;
  avgLatencyMs: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  avgTotalTokens: number;
  avgApiCalls: number;
  avgEstimatedCostUsd?: number;
};

const ALL_TASKS: TaskCase[] = [
  { id: "T01", prompt: "What is 27 + 58?", expected: 85 },
  { id: "T02", prompt: "What is 144 / 12?", expected: 12 },
  { id: "T03", prompt: "What is 13 * 7?", expected: 91 },
  { id: "T04", prompt: "What is 2^10?", expected: 1024 },
  { id: "T05", prompt: "What is gcd(84, 30)?", expected: 6 },
  { id: "T06", prompt: "What is lcm(12, 18)?", expected: 36 },
  {
    id: "T07",
    prompt: "In Fibonacci sequence with F1 = 1 and F2 = 1, what is F10?",
    expected: 55
  },
  { id: "T08", prompt: "What is the sum of integers from 1 to 100?", expected: 5050 },
  {
    id: "T09",
    prompt: "How many prime numbers are less than or equal to 30?",
    expected: 10
  },
  { id: "T10", prompt: "Convert binary 101101 to decimal.", expected: 45 },
  { id: "T11", prompt: "Rectangle area: width = 12, height = 7.", expected: 84 },
  {
    id: "T12",
    prompt: "A train moves at 60 km/h for 2.5 hours. What distance (km)?",
    expected: 150
  },
  { id: "T13", prompt: "Find the average of 4, 8, 10, 14.", expected: 9 },
  { id: "T14", prompt: "Solve for x: 3x - 5 = 16.", expected: 7 },
  {
    id: "T15",
    prompt: "How many permutations are there for 5 distinct items?",
    expected: 120
  },
  {
    id: "T16",
    prompt: "How many combinations C(6,2) are there?",
    expected: 15
  },
  {
    id: "T17",
    prompt: "If 30% of x equals 45, what is x?",
    expected: 150
  },
  {
    id: "T18",
    prompt: "How many ways to climb 10 stairs with steps of 1 or 2?",
    expected: 89
  },
  { id: "T19", prompt: "What is 1000 mod 37?", expected: 1 },
  { id: "T20", prompt: "What is log2(64)?", expected: 6 }
];

const METHODS: MethodId[] = ["direct", "step_by_step", "meta_prompt", "experts"];

const FIXED_BEHAVIOR_TASK: TaskCase = {
  id: "CUSTOM",
  prompt:
    "Я работаю в стабильной компании, все нормально, но иногда думаю, что хочу попробовать свое дело. Не потому что все плохо, а просто хочется больше смысла и интереса. При этом страшно потерять стабильность и ошибиться. Помоги спокойно разобрать, как принимать такое решение: по каким критериям сравнить варианты и как сделать аккуратный переход без резких шагов."
};

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function getEnv(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function getApiKey(): string {
  const apiKeyEnvName = getEnv("OPENAI_API_KEY_ENV");
  const apiKey = getEnv("OPENAI_API_KEY") || (apiKeyEnvName ? getEnv(apiKeyEnvName) : undefined);

  if (!apiKey) {
    fail("Missing API key. Set OPENAI_API_KEY or OPENAI_API_KEY_ENV.");
  }

  return apiKey;
}

function getModel(): string {
  const model = getEnv("OPENAI_MODEL");
  if (!model) {
    fail("Missing OPENAI_MODEL environment variable.");
  }

  return model;
}

function parseInteger(name: string, defaultValue: number): number {
  const raw = getEnv(name);
  if (!raw) {
    return defaultValue;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    fail(`Invalid ${name} value: ${raw}. Must be a positive integer.`);
  }

  return parsed;
}

function parseOptionalNumber(name: string): number | undefined {
  const raw = getEnv(name);
  if (!raw) {
    return undefined;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    fail(`Invalid ${name} value: ${raw}. Must be a non-negative number.`);
  }

  return parsed;
}

function parseReasoningSummaryMode(name: string): ReasoningSummaryMode | undefined {
  const raw = getEnv(name);
  if (!raw) {
    return undefined;
  }

  const normalized = raw.toLowerCase();
  if (normalized === "auto" || normalized === "concise" || normalized === "detailed") {
    return normalized;
  }

  fail(`Invalid ${name} value: ${raw}. Use auto|concise|detailed.`);
}

function parseAnswerNumber(output: string): number | null {
  const matches = output.match(/-?\d+(?:\.\d+)?/g);
  if (!matches || matches.length === 0) {
    return null;
  }

  const last = Number(matches[matches.length - 1]);
  return Number.isFinite(last) ? last : null;
}

function normalizeOutput(output: string): string {
  return output.replace(/\s+/g, " ").trim();
}

function isCorrectAnswer(parsedAnswer: number | null, expected: number): boolean {
  if (parsedAnswer === null) {
    return false;
  }

  return Math.abs(parsedAnswer - expected) < 1e-9;
}

function hasExpected(task: TaskCase): task is TaskCase & { expected: number } {
  return typeof task.expected === "number";
}

function buildPrompt(method: MethodId, task: TaskCase): string {
  if (method === "direct") {
    return [
      task.prompt,
      "",
      "Ограничь ответ 20 строками максимум."
    ].join("\n");
  }

  if (method === "step_by_step") {
    return [
      task.prompt,
      "",
      "Решай пошагово.",
      "Ограничь ответ 20 строками максимум."
    ].join("\n");
  }

  if (method === "experts") {
    return task.prompt;
  }

  return task.prompt;
}

function buildMetaPrompt(task: TaskCase): string {
  return [
    "Write the best short prompt to solve the task accurately.",
    "The generated prompt must include the exact task text.",
    "The generated prompt must request a concise response limited to 20 lines maximum.",
    "Return only the generated prompt.",
    "",
    `Task: ${task.prompt}`
  ].join("\n");
}

function buildSingleExpertPrompt(
  role: "critic" | "psychologist" | "teacher" | "biologist",
  task: TaskCase
): string {
  if (role === "critic") {
    return [
      "You are a Critic.",
      "Challenge weak assumptions and point out blind spots.",
      "Give practical cautions and what could go wrong.",
      "Ограничь ответ 20 строками максимум.",
      "",
      `Task: ${task.prompt}`
    ].join("\n");
  }

  if (role === "psychologist") {
    return [
      "You are a Psychologist.",
      "Focus on emotions, anxiety, internal conflict, and decision fatigue.",
      "Offer a grounded self-check framework and coping steps.",
      "Ограничь ответ 20 строками максимум.",
      "",
      `Task: ${task.prompt}`
    ].join("\n");
  }

  if (role === "teacher") {
    return [
      "You are a Teacher.",
      "Explain clearly in simple language and structure advice step by step.",
      "Give a short action plan for the next 2 weeks.",
      "Ограничь ответ 20 строками максимум.",
      "",
      `Task: ${task.prompt}`
    ].join("\n");
  }

  return [
    "You are a Biologist.",
    "Explain how stress, uncertainty, and reward systems can bias decisions.",
    "Suggest biologically informed habits that improve judgment.",
    "Ограничь ответ 20 строками максимум.",
    "",
    `Task: ${task.prompt}`
  ].join("\n");
}

function pickExpertsFinalAnswer(traces: CallTrace[]): number | null {
  const parsed = traces
    .map((trace) => ({ label: trace.label, answer: parseAnswerNumber(trace.output) }))
    .filter((item) => item.answer !== null) as Array<{ label: string; answer: number }>;

  if (parsed.length === 0) {
    return null;
  }

  const counts = new Map<number, number>();
  for (const item of parsed) {
    counts.set(item.answer, (counts.get(item.answer) ?? 0) + 1);
  }

  let bestAnswer: number | null = null;
  let bestCount = -1;
  for (const [answer, count] of counts.entries()) {
    if (count > bestCount) {
      bestAnswer = answer;
      bestCount = count;
    }
  }

  if (bestCount >= 2) {
    return bestAnswer;
  }

  const critic = parsed.find((item) => item.label === "critic");
  if (critic) {
    return critic.answer;
  }

  return parsed[parsed.length - 1].answer;
}

async function callModel(
  client: OpenAI,
  model: string,
  input: string,
  temperature?: number,
  reasoningSummaryMode?: ReasoningSummaryMode
): Promise<{ output: string; reasoningSummaries: string[]; metrics: CallMetrics }> {
  const startedAt = Date.now();
  const response = await client.responses.create({
    model,
    input,
    stream: false,
    ...(reasoningSummaryMode ? { reasoning: { summary: reasoningSummaryMode } } : {}),
    ...(temperature !== undefined ? { temperature } : {})
  });
  const latencyMs = Date.now() - startedAt;

  const output = response.output_text ?? "";
  const inputTokens = response.usage?.input_tokens ?? 0;
  const outputTokens = response.usage?.output_tokens ?? 0;
  const totalTokens = response.usage?.total_tokens ?? inputTokens + outputTokens;

  return {
    output,
    reasoningSummaries: extractReasoningSummaries(response),
    metrics: {
      inputTokens,
      outputTokens,
      totalTokens,
      latencyMs
    }
  };
}

function extractReasoningSummaries(response: Response): string[] {
  const summaries: string[] = [];

  for (const item of response.output) {
    if (item.type !== "reasoning") {
      continue;
    }

    for (const part of item.summary) {
      const text = part.text?.trim();
      if (text) {
        summaries.push(text);
      }
    }
  }

  return summaries;
}

function estimateCostUsd(
  inputTokens: number,
  outputTokens: number,
  inputPricePer1M?: number,
  outputPricePer1M?: number
): number | undefined {
  if (inputPricePer1M === undefined || outputPricePer1M === undefined) {
    return undefined;
  }

  return (inputTokens / 1_000_000) * inputPricePer1M + (outputTokens / 1_000_000) * outputPricePer1M;
}

async function runMethodForTask(
  client: OpenAI,
  model: string,
  method: MethodId,
  task: TaskCase,
  temperature: number | undefined,
  reasoningSummaryMode: ReasoningSummaryMode | undefined,
  inputPricePer1M?: number,
  outputPricePer1M?: number
): Promise<MethodRun> {
  let apiCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let latencyMs = 0;

  let output = "";
  const traces: CallTrace[] = [];

  if (method === "meta_prompt") {
    const metaPrompt = buildMetaPrompt(task);
    const metaResponse = await callModel(client, model, metaPrompt, temperature, reasoningSummaryMode);
    apiCalls += 1;
    inputTokens += metaResponse.metrics.inputTokens;
    outputTokens += metaResponse.metrics.outputTokens;
    totalTokens += metaResponse.metrics.totalTokens;
    latencyMs += metaResponse.metrics.latencyMs;
    traces.push({
      label: "meta_prompt_builder",
      prompt: metaPrompt,
      output: metaResponse.output,
      reasoningSummaries: metaResponse.reasoningSummaries,
      metrics: metaResponse.metrics
    });

    const generatedPrompt = normalizeOutput(metaResponse.output);
    const finalResponse = await callModel(client, model, generatedPrompt, temperature, reasoningSummaryMode);
    apiCalls += 1;
    inputTokens += finalResponse.metrics.inputTokens;
    outputTokens += finalResponse.metrics.outputTokens;
    totalTokens += finalResponse.metrics.totalTokens;
    latencyMs += finalResponse.metrics.latencyMs;
    traces.push({
      label: "meta_prompt_solver",
      prompt: generatedPrompt,
      output: finalResponse.output,
      reasoningSummaries: finalResponse.reasoningSummaries,
      metrics: finalResponse.metrics
    });
    output = finalResponse.output;
  } else if (method === "experts") {
    const expertPrompts: Array<{ label: string; prompt: string }> = [
      { label: "critic", prompt: buildSingleExpertPrompt("critic", task) },
      { label: "psychologist", prompt: buildSingleExpertPrompt("psychologist", task) },
      { label: "teacher", prompt: buildSingleExpertPrompt("teacher", task) },
      { label: "biologist", prompt: buildSingleExpertPrompt("biologist", task) }
    ];

    for (const expert of expertPrompts) {
      const response = await callModel(client, model, expert.prompt, temperature, reasoningSummaryMode);
      apiCalls += 1;
      inputTokens += response.metrics.inputTokens;
      outputTokens += response.metrics.outputTokens;
      totalTokens += response.metrics.totalTokens;
      latencyMs += response.metrics.latencyMs;
      traces.push({
        label: expert.label,
        prompt: expert.prompt,
        output: response.output,
        reasoningSummaries: response.reasoningSummaries,
        metrics: response.metrics
      });
    }

    output = traces.map((trace) => `[${trace.label}]\n${trace.output}`).join("\n\n");
  } else {
    const prompt = buildPrompt(method, task);
    const response = await callModel(client, model, prompt, temperature, reasoningSummaryMode);
    apiCalls += 1;
    inputTokens += response.metrics.inputTokens;
    outputTokens += response.metrics.outputTokens;
    totalTokens += response.metrics.totalTokens;
    latencyMs += response.metrics.latencyMs;
    traces.push({
      label: method,
      prompt,
      output: response.output,
      reasoningSummaries: response.reasoningSummaries,
      metrics: response.metrics
    });
    output = response.output;
  }

  const parsedAnswer = method === "experts" ? pickExpertsFinalAnswer(traces) : parseAnswerNumber(output);
  const correct = hasExpected(task) ? isCorrectAnswer(parsedAnswer, task.expected) : false;
  const estimatedCostUsd = estimateCostUsd(inputTokens, outputTokens, inputPricePer1M, outputPricePer1M);

  return {
    method,
    taskId: task.id,
    expected: task.expected,
    output,
    parsedAnswer,
    isCorrect: correct,
    apiCalls,
    inputTokens,
    outputTokens,
    totalTokens,
    latencyMs,
    estimatedCostUsd,
    traces
  };
}

function printMethodDetails(result: MethodRun): void {
  const rule = "-".repeat(72);
  console.log(pc.bold(pc.cyan(`\n    Technique: ${result.method}`)));
  console.log(pc.dim(`    ${rule}`));

  for (const trace of result.traces) {
    console.log(pc.bold(pc.magenta(`      [call: ${trace.label}]`)));
    console.log(pc.bold(pc.yellow("      prompt:")));
    for (const line of trace.prompt.split("\n")) {
      console.log(pc.yellow(`        ${line}`));
    }

    console.log(pc.bold(pc.green("      output:")));
    for (const line of trace.output.split("\n")) {
      console.log(pc.green(`        ${line}`));
    }

    if (trace.reasoningSummaries.length > 0) {
      console.log(pc.bold(pc.blue("      reasoning summary:")));
      for (const summary of trace.reasoningSummaries) {
        for (const line of summary.split("\n")) {
          console.log(pc.blue(`        - ${line}`));
        }
      }
    } else {
      console.log(pc.blue("      reasoning summary: (not returned)"));
    }

    console.log(
      pc.bold(
        pc.white(
          `      metrics: in=${trace.metrics.inputTokens}, out=${trace.metrics.outputTokens}, total=${trace.metrics.totalTokens}, latency=${trace.metrics.latencyMs}ms`
        )
      )
    );
  }

  console.log(pc.dim(`    ${rule}`));
}

function avg(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, item) => sum + item, 0) / values.length;
}

function buildSummaries(results: MethodRun[]): MethodSummary[] {
  return METHODS.map((method) => {
    const methodResults = results.filter((result) => result.method === method);
    const correct = methodResults.filter((result) => result.isCorrect).length;
    const withCost = methodResults.filter((result) => result.estimatedCostUsd !== undefined);

    return {
      method,
      correct,
      total: methodResults.length,
      accuracyPct: methodResults.length > 0 ? (correct / methodResults.length) * 100 : 0,
      avgLatencyMs: avg(methodResults.map((result) => result.latencyMs)),
      avgInputTokens: avg(methodResults.map((result) => result.inputTokens)),
      avgOutputTokens: avg(methodResults.map((result) => result.outputTokens)),
      avgTotalTokens: avg(methodResults.map((result) => result.totalTokens)),
      avgApiCalls: avg(methodResults.map((result) => result.apiCalls)),
      avgEstimatedCostUsd:
        withCost.length > 0 ? avg(withCost.map((result) => result.estimatedCostUsd ?? 0)) : undefined
    };
  });
}

function printSummaryTable(summaries: MethodSummary[]): void {
  console.log("\n=== Method comparison ===");
  console.log(
    "Method           Accuracy   Avg calls   Avg latency   Avg in tok   Avg out tok   Avg total tok   Avg est. cost"
  );

  for (const summary of summaries) {
    const accuracy = `${summary.correct}/${summary.total} (${summary.accuracyPct.toFixed(1)}%)`;
    const avgCost = summary.avgEstimatedCostUsd !== undefined
      ? `$${summary.avgEstimatedCostUsd.toFixed(6)}`
      : "n/a";

    console.log(
      `${summary.method.padEnd(15)} ${accuracy.padEnd(18)} ${summary.avgApiCalls
        .toFixed(2)
        .padEnd(11)} ${summary.avgLatencyMs.toFixed(0).padEnd(13)} ${summary.avgInputTokens
        .toFixed(1)
        .padEnd(12)} ${summary.avgOutputTokens.toFixed(1).padEnd(13)} ${summary.avgTotalTokens
        .toFixed(1)
        .padEnd(15)} ${avgCost}`
    );
  }
}

function printDisagreements(results: MethodRun[]): void {
  console.log("\n=== Tasks with different answers across methods ===");

  let found = 0;

  for (const task of ALL_TASKS) {
    const taskResults = results.filter((result) => result.taskId === task.id);
    if (taskResults.length === 0) {
      continue;
    }

    const parsedValues = new Set(taskResults.map((result) => String(result.parsedAnswer)));
    if (parsedValues.size <= 1) {
      continue;
    }

    found += 1;
    console.log(`- ${task.id} (expected ${task.expected}):`);
    for (const result of taskResults) {
      console.log(`  ${result.method}: parsed=${String(result.parsedAnswer)} correct=${result.isCorrect}`);
    }
  }

  if (found === 0) {
    console.log("No disagreements detected.");
  }
}

function printBestMethod(summaries: MethodSummary[]): void {
  const sorted = [...summaries].sort((a, b) => {
    if (b.accuracyPct !== a.accuracyPct) {
      return b.accuracyPct - a.accuracyPct;
    }

    return a.avgTotalTokens - b.avgTotalTokens;
  });

  const best = sorted[0];
  console.log("\n=== Best method ===");
  console.log(
    `${best.method} (accuracy ${best.accuracyPct.toFixed(1)}%, avg total tokens ${best.avgTotalTokens.toFixed(1)})`
  );
}

function buildTasks(): TaskCase[] {
  return [FIXED_BEHAVIOR_TASK];
}

async function main(): Promise<void> {
  const apiKey = getApiKey();
  const model = getModel();
  const baseUrl = (getEnv("OPENAI_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const runsPerTask = parseInteger("EXPERIMENT_RUNS_PER_TASK", 1);
  const temperature = parseOptionalNumber("EXPERIMENT_TEMPERATURE");
  const reasoningSummaryMode = parseReasoningSummaryMode("EXPERIMENT_REASONING_SUMMARY");
  const inputPricePer1M = parseOptionalNumber("EXPERIMENT_PRICE_INPUT_PER_1M");
  const outputPricePer1M = parseOptionalNumber("EXPERIMENT_PRICE_OUTPUT_PER_1M");

  const tasks = buildTasks();

  const client = new OpenAI({
    apiKey,
    baseURL: baseUrl,
    maxRetries: 0
  });

  console.log("Running experiment...");
  console.log(`Model: ${model}`);
  console.log(`Tasks: ${tasks.length}`);
  console.log(`Runs per task: ${runsPerTask}`);
  console.log(`Methods: ${METHODS.join(", ")}`);
  if (temperature !== undefined) {
    console.log(`Temperature: ${temperature}`);
  }
  if (reasoningSummaryMode) {
    console.log(`Reasoning summary: ${reasoningSummaryMode}`);
  }
  if (inputPricePer1M !== undefined && outputPricePer1M !== undefined) {
    console.log(`Pricing: input=$${inputPricePer1M}/1M, output=$${outputPricePer1M}/1M`);
  }

  const allResults: MethodRun[] = [];

  for (let runIndex = 0; runIndex < runsPerTask; runIndex += 1) {
    console.log(`\nRun ${runIndex + 1}/${runsPerTask}`);

    for (const task of tasks) {
      console.log(`  ${task.id}: ${task.prompt}`);

      for (const method of METHODS) {
        const result = await runMethodForTask(
          client,
          model,
          method,
          task,
          temperature,
          reasoningSummaryMode,
          inputPricePer1M,
          outputPricePer1M
        );

        allResults.push(result);
        printMethodDetails(result);
      }
    }
  }

  const hasAnyExpected = tasks.some((task) => hasExpected(task));
  if (hasAnyExpected) {
    const summaries = buildSummaries(allResults);
    printSummaryTable(summaries);
    printDisagreements(allResults);
    printBestMethod(summaries);
  } else {
    console.log("\n=== Comparison mode (no expected answer) ===");
    console.log("Displayed prompts, outputs, reasoning summaries, and call metrics for behavior comparison.");
  }
}

await main();
