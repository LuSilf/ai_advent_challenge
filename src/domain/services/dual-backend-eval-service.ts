import type { Embedder } from "../ports/embedder";
import type { LLMClient } from "../ports/llm-client";
import type { LLMRequest } from "../models";
import type { VectorIndex } from "../ports/vector-index";
import type { ControlQuestion } from "./rag-evaluation-service";
import {
  RagPipelineService,
  type PipelineRetrieveResult,
  type RagMode,
} from "./rag-pipeline-service";

export type BackendConfig = {
  name: string;
  llmClient: LLMClient;
  modelId: string;
  systemPrompt?: string;
  maxCompletionTokens?: number;
  temperatureOverride?: number;
  ollamaOptions?: { numCtx?: number; numPredict?: number; temperature?: number };
};

export type EvalMode = {
  name: string;
  rag?: RagMode;
};

export type AnswerErrorClass =
  | "timeout"
  | "connection"
  | "http-4xx"
  | "http-5xx"
  | "other";

export type AnswerRun = {
  questionId: string;
  modeName: string;
  backendName: string;
  runIndex: number;
  latencyMs: number;
  answer: string;
  error?: string;
  errorClass?: AnswerErrorClass;
  usage?: { inputTokens: number; outputTokens: number };
  retrieval?: PipelineRetrieveResult;
};

export type RunMeta = {
  questionId: string;
  modeName: string;
  backendName: string;
  runIndex: number;
};

export type RunProgress = {
  index: number;
  totalRuns: number;
};

export type DualBackendEvalObserver = {
  onRunStart?: (meta: RunMeta, progress: RunProgress) => void;
  onRunDone?: (run: AnswerRun, progress: RunProgress) => void;
};

export type DualBackendEvalOptions = {
  questions: ControlQuestion[];
  modes: EvalMode[];
  backends: BackendConfig[];
  runs: number;
  temperature?: number;
  maxCompletionTokens?: number;
  observer?: DualBackendEvalObserver;
};

export class DualBackendEvalService {
  constructor(
    private readonly embedder: Embedder,
    private readonly vectorIndex: VectorIndex,
  ) {}

  async run(options: DualBackendEvalOptions): Promise<AnswerRun[]> {
    const { questions, modes, backends, runs, observer } = options;
    const totalRuns = questions.length * modes.length * backends.length * runs;
    const results: AnswerRun[] = [];
    let globalIndex = 0;

    for (const question of questions) {
      for (const mode of modes) {
        const retrieval = mode.rag
          ? await new RagPipelineService(this.embedder, this.vectorIndex, mode.rag).retrieve(question.question)
          : undefined;
        const promptSuffix =
          retrieval && retrieval.status === "ok" ? retrieval.promptSuffix : undefined;

        for (const backend of backends) {
          for (let runIndex = 1; runIndex <= runs; runIndex++) {
            globalIndex += 1;
            const meta: RunMeta = {
              questionId: question.id,
              modeName: mode.name,
              backendName: backend.name,
              runIndex,
            };
            const progress: RunProgress = { index: globalIndex, totalRuns };
            observer?.onRunStart?.(meta, progress);

            const run = await executeOne(
              question,
              mode,
              backend,
              runIndex,
              promptSuffix,
              retrieval,
              options.temperature,
              options.maxCompletionTokens,
            );
            results.push(run);
            observer?.onRunDone?.(run, progress);
          }
        }
      }
    }

    return results;
  }
}

async function executeOne(
  question: ControlQuestion,
  mode: EvalMode,
  backend: BackendConfig,
  runIndex: number,
  promptSuffix: string | undefined,
  retrieval: PipelineRetrieveResult | undefined,
  temperature: number | undefined,
  maxCompletionTokens: number | undefined,
): Promise<AnswerRun> {
  const userContent = promptSuffix
    ? `${question.question}\n\n${promptSuffix}`
    : question.question;
  const effectiveTemperature = backend.temperatureOverride ?? temperature;
  const extraBody = backend.ollamaOptions
    ? {
        options: {
          ...(backend.ollamaOptions.numCtx !== undefined ? { num_ctx: backend.ollamaOptions.numCtx } : {}),
          ...(backend.ollamaOptions.numPredict !== undefined ? { num_predict: backend.ollamaOptions.numPredict } : {}),
          ...(backend.ollamaOptions.temperature !== undefined ? { temperature: backend.ollamaOptions.temperature } : {}),
        },
      }
    : undefined;
  const request: LLMRequest = {
    model: backend.modelId,
    instructions: backend.systemPrompt ?? "",
    messages: [
      {
        id: 0,
        sessionId: 0,
        role: "user",
        content: userContent,
        createdAt: "",
      },
    ],
    params: {
      stream: false,
      temperature: effectiveTemperature,
      maxCompletionTokens: backend.maxCompletionTokens ?? maxCompletionTokens,
      extraBody,
    },
  };

  const started = Date.now();
  try {
    const response = await backend.llmClient.send(request);
    const latencyMs = Date.now() - started;
    return {
      questionId: question.id,
      modeName: mode.name,
      backendName: backend.name,
      runIndex,
      latencyMs,
      answer: response.content,
      usage: {
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
      },
      retrieval,
    };
  } catch (error) {
    const latencyMs = Date.now() - started;
    const message = error instanceof Error ? error.message : String(error);
    return {
      questionId: question.id,
      modeName: mode.name,
      backendName: backend.name,
      runIndex,
      latencyMs,
      answer: "",
      error: message,
      errorClass: classifyError(message),
      retrieval,
    };
  }
}

export function classifyError(message: string): AnswerErrorClass {
  const m = message.toLowerCase();
  if (m.includes("timed out") || m.includes("timeout") || m.includes("aborted")) {
    return "timeout";
  }
  if (
    m.includes("connection") ||
    m.includes("econnrefused") ||
    m.includes("econnreset") ||
    m.includes("network")
  ) {
    return "connection";
  }
  if (/\bhttp\s*5\d\d\b/.test(m) || /\b5\d\d\b/.test(m)) {
    return "http-5xx";
  }
  if (/\bhttp\s*4\d\d\b/.test(m) || /\b4\d\d\b/.test(m)) {
    return "http-4xx";
  }
  return "other";
}
