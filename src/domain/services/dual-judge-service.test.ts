import { describe, test, expect } from "bun:test";
import {
  DualJudgeService,
  type JudgedAnswerRun,
} from "./dual-judge-service";
import { RagJudgeService } from "./rag-judge-service";
import type { AnswerRun } from "./dual-backend-eval-service";
import type { ControlQuestion } from "./rag-evaluation-service";
import type { LLMClient } from "../ports/llm-client";
import type { LLMRequest, LLMResponse, Model } from "../models";
import type { ModelRepository } from "../ports/model-repository";

type FakeClientOptions = {
  responder?: (request: LLMRequest) => string | Error;
  captured?: LLMRequest[];
};

class FakeLLMClient implements LLMClient {
  constructor(private readonly opts: FakeClientOptions = {}) {}

  async send(request: LLMRequest): Promise<LLMResponse & { rawResponse?: unknown }> {
    if (this.opts.captured) this.opts.captured.push(request);
    const result = this.opts.responder?.(request) ?? '{"score": 2, "verdict": "ok"}';
    if (result instanceof Error) throw result;
    return { content: result, inputTokens: 0, outputTokens: 0 };
  }

  async *stream() {
    throw new Error("not implemented");
  }
}

function makeModelRepo(modelId: string): ModelRepository {
  const model: Model = {
    id: modelId,
    name: modelId,
    inputPrice: 0,
    outputPrice: 0,
    contextSize: 1,
  };
  return {
    getAll: () => [model],
    getById: () => model,
    getRole: (role) => (role === "judge" || role === "chat" ? model : null),
    getRoles: () => [],
    setRole: () => {},
  };
}

function makeQuestion(id: string): ControlQuestion {
  return { id, question: `question ${id}`, expectation: "exp" };
}

function makeRun(
  questionId: string,
  overrides: Partial<AnswerRun> = {},
): AnswerRun {
  return {
    questionId,
    modeName: "baseline",
    backendName: "local",
    runIndex: 1,
    latencyMs: 100,
    answer: "some answer",
    ...overrides,
  };
}

describe("DualJudgeService", () => {
  test("happy path: three runs → three JudgedAnswerRun with both verdicts", async () => {
    const cloudClient = new FakeLLMClient({
      responder: () => '{"score": 3, "verdict": "great"}',
    });
    const localClient = new FakeLLMClient({
      responder: () => '{"score": 2, "verdict": "fine"}',
    });
    const cloudJudge = new RagJudgeService(cloudClient, makeModelRepo("cloud-model"));
    const localJudge = new RagJudgeService(localClient, makeModelRepo("local-model"));
    const service = new DualJudgeService(cloudJudge, localJudge);

    const questions = [makeQuestion("q1"), makeQuestion("q2"), makeQuestion("q3")];
    const runs = questions.map((q) => makeRun(q.id));

    const result = await service.judgeAll(runs, questions);

    expect(result).toHaveLength(3);
    for (const r of result) {
      expect(r.cloudJudge?.score).toBe(3);
      expect(r.cloudJudge?.modelId).toBe("cloud-model");
      expect(r.localJudge?.score).toBe(2);
      expect(r.localJudge?.modelId).toBe("local-model");
      expect(r.cloudJudgeError).toBeUndefined();
      expect(r.localJudgeError).toBeUndefined();
    }
  });

  test("one judge fails on one run — other judge and other runs unaffected", async () => {
    let cloudCalls = 0;
    const cloudClient = new FakeLLMClient({
      responder: () => {
        cloudCalls += 1;
        if (cloudCalls === 2) return new Error("HTTP 500");
        return '{"score": 3, "verdict": "ok"}';
      },
    });
    const localClient = new FakeLLMClient({
      responder: () => '{"score": 2, "verdict": "ok"}',
    });
    const cloudJudge = new RagJudgeService(cloudClient, makeModelRepo("cloud-m"));
    const localJudge = new RagJudgeService(localClient, makeModelRepo("local-m"));
    const service = new DualJudgeService(cloudJudge, localJudge);

    const questions = [makeQuestion("q1"), makeQuestion("q2"), makeQuestion("q3")];
    const runs = questions.map((q) => makeRun(q.id));

    const result = await service.judgeAll(runs, questions);

    expect(result).toHaveLength(3);
    expect(result[0]!.cloudJudge?.score).toBe(3);
    expect(result[0]!.localJudge?.score).toBe(2);
    expect(result[1]!.cloudJudge).toBeUndefined();
    expect(result[1]!.cloudJudgeError).toContain("500");
    expect(result[1]!.localJudge?.score).toBe(2);
    expect(result[2]!.cloudJudge?.score).toBe(3);
    expect(result[2]!.localJudge?.score).toBe(2);
  });

  test("both judges fail on a run — both error fields set, no score", async () => {
    const cloudClient = new FakeLLMClient({
      responder: () => new Error("cloud down"),
    });
    const localClient = new FakeLLMClient({
      responder: () => new Error("local down"),
    });
    const cloudJudge = new RagJudgeService(cloudClient, makeModelRepo("cm"));
    const localJudge = new RagJudgeService(localClient, makeModelRepo("lm"));
    const service = new DualJudgeService(cloudJudge, localJudge);

    const questions = [makeQuestion("q1")];
    const result = await service.judgeAll([makeRun("q1")], questions);

    expect(result).toHaveLength(1);
    expect(result[0]!.cloudJudge).toBeUndefined();
    expect(result[0]!.cloudJudgeError).toContain("cloud down");
    expect(result[0]!.localJudge).toBeUndefined();
    expect(result[0]!.localJudgeError).toContain("local down");
  });

  test("failed AnswerRun: judges receive placeholder '(failed)' answer", async () => {
    const captured: LLMRequest[] = [];
    const cloudClient = new FakeLLMClient({
      responder: () => '{"score": 0, "verdict": "no answer"}',
      captured,
    });
    const localClient = new FakeLLMClient({
      responder: () => '{"score": 0, "verdict": "no answer"}',
    });
    const cloudJudge = new RagJudgeService(cloudClient, makeModelRepo("cm"));
    const localJudge = new RagJudgeService(localClient, makeModelRepo("lm"));
    const service = new DualJudgeService(cloudJudge, localJudge);

    const questions = [makeQuestion("q1")];
    const failedRun = makeRun("q1", { answer: "", error: "timeout", errorClass: "timeout" });

    const result = await service.judgeAll([failedRun], questions);

    expect(result).toHaveLength(1);
    expect(captured[0]!.messages[0]!.content).toContain("(failed)");
    expect(result[0]!.cloudJudge?.score).toBe(0);
    expect(result[0]!.error).toBe("timeout");
  });

  test("both judges receive identical JUDGE_INSTRUCTIONS", async () => {
    const cloudCaptured: LLMRequest[] = [];
    const localCaptured: LLMRequest[] = [];
    const cloudClient = new FakeLLMClient({ captured: cloudCaptured });
    const localClient = new FakeLLMClient({ captured: localCaptured });
    const cloudJudge = new RagJudgeService(cloudClient, makeModelRepo("cm"));
    const localJudge = new RagJudgeService(localClient, makeModelRepo("lm"));
    const service = new DualJudgeService(cloudJudge, localJudge);

    await service.judgeAll([makeRun("q1")], [makeQuestion("q1")]);

    expect(cloudCaptured).toHaveLength(1);
    expect(localCaptured).toHaveLength(1);
    expect(cloudCaptured[0]!.instructions).toBe(localCaptured[0]!.instructions);
  });

  test("observer receives start/done events with progress", async () => {
    const cloudClient = new FakeLLMClient();
    const localClient = new FakeLLMClient();
    const cloudJudge = new RagJudgeService(cloudClient, makeModelRepo("cm"));
    const localJudge = new RagJudgeService(localClient, makeModelRepo("lm"));
    const service = new DualJudgeService(cloudJudge, localJudge);

    const starts: Array<{ index: number; total: number }> = [];
    const dones: Array<{ index: number; total: number }> = [];
    await service.judgeAll(
      [makeRun("q1"), makeRun("q2")],
      [makeQuestion("q1"), makeQuestion("q2")],
      {
        onJudgeStart: (_m, p) => starts.push(p),
        onJudgeDone: (_r, p) => dones.push(p),
      },
    );

    expect(starts).toHaveLength(2);
    expect(dones).toHaveLength(2);
    expect(starts[0]).toEqual({ index: 1, total: 2 });
    expect(starts[1]).toEqual({ index: 2, total: 2 });
  });

  test("missing question in map throws with clear error", async () => {
    const cloudClient = new FakeLLMClient();
    const localClient = new FakeLLMClient();
    const cloudJudge = new RagJudgeService(cloudClient, makeModelRepo("cm"));
    const localJudge = new RagJudgeService(localClient, makeModelRepo("lm"));
    const service = new DualJudgeService(cloudJudge, localJudge);

    await expect(
      service.judgeAll([makeRun("q-missing")], [makeQuestion("q1")]),
    ).rejects.toThrow(/q-missing/);
  });
});

describe("JudgedAnswerRun type", () => {
  test("preserves all AnswerRun fields", () => {
    const judged: JudgedAnswerRun = {
      questionId: "q1",
      modeName: "rag-plain",
      backendName: "local",
      runIndex: 2,
      latencyMs: 500,
      answer: "ans",
    };
    expect(judged.questionId).toBe("q1");
    expect(judged.cloudJudge).toBeUndefined();
  });
});
