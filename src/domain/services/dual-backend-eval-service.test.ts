import { describe, test, expect } from "bun:test";
import {
  DualBackendEvalService,
  type BackendConfig,
  type EvalMode,
} from "./dual-backend-eval-service";
import type { RagMode } from "./rag-pipeline-service";
import type { Embedder } from "../ports/embedder";
import type { VectorIndex } from "../ports/vector-index";
import type { LLMClient } from "../ports/llm-client";
import type { LLMRequest, LLMResponse } from "../models";
import type { ControlQuestion } from "./rag-evaluation-service";
import type { VectorSearchHit } from "../models/chunking";

function makeQuestion(id: string, question: string): ControlQuestion {
  return { id, question, expectation: "expected" };
}

function makeHit(id: number, distance: number): VectorSearchHit {
  return {
    id,
    strategy: "structural",
    source: "test.md",
    title: null,
    section: `section-${id}`,
    chunkIndex: 0,
    charStart: 0,
    charEnd: 100,
    text: `chunk text ${id}`,
    distance,
  };
}

function makeEmbedder(): Embedder {
  return {
    dimension: 768,
    embed: async () => [new Float32Array(768)],
  };
}

function makeIndex(hits: VectorSearchHit[], count = 10): VectorIndex {
  return {
    search: () => hits,
    countByStrategy: () => count,
    upsert: () => {},
    deleteByStrategy: () => 0,
  };
}

type CapturedRequest = { request: LLMRequest };

function makeClient(
  textOrError: string | Error,
  captured?: CapturedRequest[],
): LLMClient {
  return {
    async send(request: LLMRequest): Promise<LLMResponse> {
      if (captured) captured.push({ request });
      if (textOrError instanceof Error) throw textOrError;
      return {
        content: textOrError,
        inputTokens: 10,
        outputTokens: 20,
      };
    },
    async *stream() {
      yield {
        type: "done" as const,
        response: { content: "", inputTokens: 0, outputTokens: 0 },
      };
    },
  };
}

function makeBackend(name: string, client: LLMClient, modelId = "test-model"): BackendConfig {
  return { name, llmClient: client, modelId };
}

const ragMode: RagMode = {
  name: "rag-plain",
  strategy: "structural",
  topKInitial: 3,
  topKFinal: 3,
};

const baselineMode: EvalMode = { name: "baseline" };

describe("DualBackendEvalService", () => {
  test("tracer-bullet: 1 question × 1 mode (baseline) × 1 backend × 1 run", async () => {
    const service = new DualBackendEvalService(makeEmbedder(), makeIndex([]));
    const result = await service.run({
      questions: [makeQuestion("q1", "what is cache-aside?")],
      modes: [baselineMode],
      backends: [makeBackend("local", makeClient("Cache-aside loads on miss."))],
      runs: 1,
    });
    expect(result).toHaveLength(1);
    const r = result[0]!;
    expect(r.questionId).toBe("q1");
    expect(r.modeName).toBe("baseline");
    expect(r.backendName).toBe("local");
    expect(r.runIndex).toBe(1);
    expect(r.answer).toBe("Cache-aside loads on miss.");
    expect(r.error).toBeUndefined();
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    expect(r.retrieval).toBeUndefined();
    expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
  });

  test("matrix ordering: for question: for mode: for backend: for run", async () => {
    const service = new DualBackendEvalService(makeEmbedder(), makeIndex([makeHit(1, 0.5)]));
    const result = await service.run({
      questions: [makeQuestion("q1", "a?"), makeQuestion("q2", "b?")],
      modes: [baselineMode, { name: "rag-plain", rag: ragMode }],
      backends: [
        makeBackend("local", makeClient("la")),
        makeBackend("cloud", makeClient("ca")),
      ],
      runs: 2,
    });
    expect(result).toHaveLength(16);
    const expected: Array<[string, string, string, number]> = [
      ["q1", "baseline", "local", 1], ["q1", "baseline", "local", 2],
      ["q1", "baseline", "cloud", 1], ["q1", "baseline", "cloud", 2],
      ["q1", "rag-plain", "local", 1], ["q1", "rag-plain", "local", 2],
      ["q1", "rag-plain", "cloud", 1], ["q1", "rag-plain", "cloud", 2],
      ["q2", "baseline", "local", 1], ["q2", "baseline", "local", 2],
      ["q2", "baseline", "cloud", 1], ["q2", "baseline", "cloud", 2],
      ["q2", "rag-plain", "local", 1], ["q2", "rag-plain", "local", 2],
      ["q2", "rag-plain", "cloud", 1], ["q2", "rag-plain", "cloud", 2],
    ];
    result.forEach((r, i) => {
      expect([r.questionId, r.modeName, r.backendName, r.runIndex]).toEqual(expected[i]!);
    });
  });

  test("fail-per-run: one failing call does not stop the sweep, error is classified", async () => {
    let callCount = 0;
    const flakyClient: LLMClient = {
      async send(): Promise<LLMResponse> {
        callCount += 1;
        if (callCount === 2) throw new Error("Request failed with HTTP 500 Server Error");
        return { content: `ok-${callCount}`, inputTokens: 5, outputTokens: 5 };
      },
      async *stream() {
        yield {
          type: "done" as const,
          response: { content: "", inputTokens: 0, outputTokens: 0 },
        };
      },
    };
    const service = new DualBackendEvalService(makeEmbedder(), makeIndex([]));
    const result = await service.run({
      questions: [makeQuestion("q1", "a?")],
      modes: [baselineMode],
      backends: [makeBackend("local", flakyClient)],
      runs: 3,
    });
    expect(result).toHaveLength(3);
    expect(result[0]!.error).toBeUndefined();
    expect(result[0]!.answer).toBe("ok-1");
    expect(result[1]!.error).toContain("500");
    expect(result[1]!.errorClass).toBe("http-5xx");
    expect(result[1]!.answer).toBe("");
    expect(result[1]!.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result[2]!.error).toBeUndefined();
    expect(result[2]!.answer).toBe("ok-3");
  });

  test("error classification: timeout, connection, 4xx, 5xx, other", async () => {
    const cases: Array<[string, string]> = [
      ["Request timed out after 30s", "timeout"],
      ["Connection error.", "connection"],
      ["ECONNREFUSED", "connection"],
      ["HTTP 404 Not Found", "http-4xx"],
      ["HTTP 503 Service Unavailable", "http-5xx"],
      ["Something else happened", "other"],
    ];
    for (const [msg, cls] of cases) {
      const client: LLMClient = {
        async send(): Promise<LLMResponse> {
          throw new Error(msg);
        },
        async *stream() {
          yield {
            type: "done" as const,
            response: { content: "", inputTokens: 0, outputTokens: 0 },
          };
        },
      };
      const service = new DualBackendEvalService(makeEmbedder(), makeIndex([]));
      const result = await service.run({
        questions: [makeQuestion("q1", "a?")],
        modes: [baselineMode],
        backends: [makeBackend("local", client)],
        runs: 1,
      });
      expect(result[0]!.errorClass).toBe(cls as "timeout" | "connection" | "http-4xx" | "http-5xx" | "other");
    }
  });

  test("parameters are forwarded to LLMRequest", async () => {
    const captured: CapturedRequest[] = [];
    const service = new DualBackendEvalService(makeEmbedder(), makeIndex([]));
    await service.run({
      questions: [makeQuestion("q1", "a?")],
      modes: [baselineMode],
      backends: [makeBackend("local", makeClient("ok", captured), "my-model")],
      runs: 1,
      temperature: 0.2,
      maxCompletionTokens: 500,
    });
    expect(captured).toHaveLength(1);
    const req = captured[0]!.request;
    expect(req.model).toBe("my-model");
    expect(req.params.temperature).toBe(0.2);
    expect(req.params.maxCompletionTokens).toBe(500);
    expect(req.messages).toHaveLength(1);
    expect(req.messages[0]!.content).toBe("a?");
  });

  test("system prompt from backend is forwarded as instructions", async () => {
    const captured: CapturedRequest[] = [];
    const service = new DualBackendEvalService(makeEmbedder(), makeIndex([]));
    await service.run({
      questions: [makeQuestion("q1", "a?")],
      modes: [baselineMode],
      backends: [{
        name: "local",
        llmClient: makeClient("ok", captured),
        modelId: "m",
        systemPrompt: "Be concise.",
      }],
      runs: 1,
    });
    expect(captured[0]!.request.instructions).toBe("Be concise.");
  });

  test("RAG mode: retrieval runs once per (question, mode), shared across backends and runs", async () => {
    let searchCount = 0;
    const index: VectorIndex = {
      search: () => {
        searchCount += 1;
        return [makeHit(1, 0.5)];
      },
      countByStrategy: () => 10,
      upsert: () => {},
      deleteByStrategy: () => 0,
    };
    const captured: CapturedRequest[] = [];
    const service = new DualBackendEvalService(makeEmbedder(), index);
    const result = await service.run({
      questions: [makeQuestion("q1", "cache-aside?")],
      modes: [{ name: "rag-plain", rag: ragMode }],
      backends: [
        makeBackend("local", makeClient("la", captured)),
        makeBackend("cloud", makeClient("ca", captured)),
      ],
      runs: 3,
    });
    expect(searchCount).toBe(1);
    expect(result).toHaveLength(6);
    expect(result.every((r) => r.retrieval?.status === "ok")).toBe(true);
    expect(captured).toHaveLength(6);
    for (const c of captured) {
      expect(c.request.messages[0]!.content).toContain("cache-aside?");
      expect(c.request.messages[0]!.content).toContain("Найденные материалы:");
    }
  });

  test("RAG mode no_index: answer is still generated without prompt suffix", async () => {
    const emptyIndex = makeIndex([], 0);
    const captured: CapturedRequest[] = [];
    const service = new DualBackendEvalService(makeEmbedder(), emptyIndex);
    const result = await service.run({
      questions: [makeQuestion("q1", "a?")],
      modes: [{ name: "rag-plain", rag: ragMode }],
      backends: [makeBackend("local", makeClient("ans", captured))],
      runs: 1,
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.retrieval?.status).toBe("no_index");
    expect(result[0]!.answer).toBe("ans");
    expect(captured[0]!.request.messages[0]!.content).toBe("a?");
  });

  test("baseline mode skips retrieval entirely", async () => {
    let searchCount = 0;
    let countCalls = 0;
    const index: VectorIndex = {
      search: () => {
        searchCount += 1;
        return [];
      },
      countByStrategy: () => {
        countCalls += 1;
        return 10;
      },
      upsert: () => {},
      deleteByStrategy: () => 0,
    };
    const service = new DualBackendEvalService(makeEmbedder(), index);
    const result = await service.run({
      questions: [makeQuestion("q1", "a?")],
      modes: [baselineMode],
      backends: [makeBackend("local", makeClient("ans"))],
      runs: 2,
    });
    expect(searchCount).toBe(0);
    expect(countCalls).toBe(0);
    expect(result).toHaveLength(2);
    expect(result[0]!.retrieval).toBeUndefined();
  });

  test("observer receives start/done events with global progress", async () => {
    const starts: Array<{ index: number; totalRuns: number }> = [];
    const dones: Array<{ index: number; totalRuns: number }> = [];
    const service = new DualBackendEvalService(makeEmbedder(), makeIndex([]));
    await service.run({
      questions: [makeQuestion("q1", "a?")],
      modes: [baselineMode],
      backends: [
        makeBackend("local", makeClient("ans")),
        makeBackend("cloud", makeClient("ans")),
      ],
      runs: 2,
      observer: {
        onRunStart: (_run, total) => starts.push(total),
        onRunDone: (_run, total) => dones.push(total),
      },
    });
    expect(starts).toHaveLength(4);
    expect(dones).toHaveLength(4);
    expect(starts[0]).toEqual({ index: 1, totalRuns: 4 });
    expect(starts[3]).toEqual({ index: 4, totalRuns: 4 });
  });
});
