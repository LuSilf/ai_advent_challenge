import { describe, test, expect } from "bun:test";

import { AssistantOrchestrator, type OrchestratorEvent } from "./assistant-orchestrator";
import type {
  AssistantLLMClient,
  AssistantStreamEvent,
  AssistantStreamRequest,
} from "../ports/assistant-llm";
import type { Embedder } from "../ports/embedder";
import type { VectorIndex } from "../ports/vector-index";
import type { Chunk, VectorSearchHit } from "../models/chunking";

class StubEmbedder implements Embedder {
  readonly dimension = 4;
  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map(() => new Float32Array([1, 0, 0, 0]));
  }
}

function makeChunk(source: string, lineStart: number, lineEnd: number, text: string, distance: number): VectorSearchHit {
  return {
    id: 1,
    strategy: "fixed",
    source,
    title: null,
    section: null,
    chunkIndex: 0,
    charStart: 0,
    charEnd: text.length,
    text,
    lineStart,
    lineEnd,
    distance,
  };
}

class StubVectorIndex implements VectorIndex {
  constructor(private readonly hits: VectorSearchHit[]) {}
  upsert(): void {}
  search(): VectorSearchHit[] {
    return this.hits;
  }
  deleteByStrategy(): number {
    return 0;
  }
  countByStrategy(): number {
    return 0;
  }
}

class ScriptedLLM implements AssistantLLMClient {
  capturedRequests: AssistantStreamRequest[] = [];
  constructor(private readonly script: AssistantStreamEvent[][]) {}
  async *stream(req: AssistantStreamRequest): AsyncIterable<AssistantStreamEvent> {
    this.capturedRequests.push(req);
    const turn = this.script.shift();
    if (!turn) {
      yield { kind: "delta", text: "[no more scripted turns]" };
      yield { kind: "done", finishReason: "stop" };
      return;
    }
    for (const ev of turn) yield ev;
  }
}

async function collect(orchestrator: AssistantOrchestrator, q: string, history: any[] = []): Promise<OrchestratorEvent[]> {
  const events: OrchestratorEvent[] = [];
  for await (const ev of orchestrator.ask(q, history)) events.push(ev);
  return events;
}

describe("AssistantOrchestrator (RAG without tool-use)", () => {
  test("emits Retrieval → Token* → Final in order", async () => {
    const llm = new ScriptedLLM([
      [
        { kind: "delta", text: "Ответ " },
        { kind: "delta", text: "по [1] и [2]." },
        { kind: "done", finishReason: "stop" },
      ],
    ]);
    const orchestrator = new AssistantOrchestrator({
      llmClient: llm,
      embedder: new StubEmbedder(),
      vectorIndex: new StubVectorIndex([
        makeChunk("README.md", 1, 5, "first", 0.1),
        makeChunk("src/x.ts", 10, 20, "second", 0.2),
      ]),
      model: "test-model",
      topK: 5,
      systemPromptHeader: "Ты ассистент проекта.",
      toolLoopMax: 5,
    });

    const events = await collect(orchestrator, "вопрос?");
    const kinds = events.map((e) => e.kind);
    expect(kinds[0]).toBe("retrieval");
    expect(kinds.at(-1)).toBe("final");
    expect(events.filter((e) => e.kind === "token").length).toBe(2);
  });

  test("retrieval event contains hits with file/line metadata", async () => {
    const llm = new ScriptedLLM([
      [{ kind: "done", finishReason: "stop" }],
    ]);
    const orchestrator = new AssistantOrchestrator({
      llmClient: llm,
      embedder: new StubEmbedder(),
      vectorIndex: new StubVectorIndex([makeChunk("README.md", 5, 10, "text", 0.3)]),
      model: "m",
      topK: 5,
      systemPromptHeader: "h",
      toolLoopMax: 5,
    });
    const events = await collect(orchestrator, "q");
    const retrieval = events.find((e) => e.kind === "retrieval");
    expect(retrieval?.kind).toBe("retrieval");
    if (retrieval?.kind === "retrieval") {
      expect(retrieval.hits.length).toBe(1);
      expect(retrieval.hits[0]?.source).toBe("README.md");
      expect(retrieval.hits[0]?.lineStart).toBe(5);
      expect(retrieval.hits[0]?.lineEnd).toBe(10);
    }
  });

  test("system prompt includes context block with [N] file:line citations", async () => {
    const llm = new ScriptedLLM([[{ kind: "done", finishReason: "stop" }]]);
    const orchestrator = new AssistantOrchestrator({
      llmClient: llm,
      embedder: new StubEmbedder(),
      vectorIndex: new StubVectorIndex([
        makeChunk("README.md", 1, 5, "alpha", 0.1),
        makeChunk("src/x.ts", 10, 20, "beta", 0.2),
      ]),
      model: "m",
      topK: 5,
      systemPromptHeader: "Ты ассистент.",
      toolLoopMax: 5,
    });
    await collect(orchestrator, "q");

    const req = llm.capturedRequests[0]!;
    const system = req.messages[0];
    expect(system?.role).toBe("system");
    expect(system?.content).toContain("[1] README.md:1-5");
    expect(system?.content).toContain("[2] src/x.ts:10-20");
    expect(system?.content).toContain("alpha");
    expect(system?.content).toContain("beta");
  });

  test("user message and history are passed through", async () => {
    const llm = new ScriptedLLM([[{ kind: "done", finishReason: "stop" }]]);
    const orchestrator = new AssistantOrchestrator({
      llmClient: llm,
      embedder: new StubEmbedder(),
      vectorIndex: new StubVectorIndex([]),
      model: "m",
      topK: 5,
      systemPromptHeader: "h",
      toolLoopMax: 5,
    });
    await collect(orchestrator, "вопрос?", [
      { role: "user", content: "первый" },
      { role: "assistant", content: "ответ" },
    ]);
    const req = llm.capturedRequests[0]!;
    const roles = req.messages.map((m) => m.role);
    expect(roles[0]).toBe("system");
    expect(roles).toContain("user");
    expect(req.messages.at(-1)).toEqual({ role: "user", content: "вопрос?" });
  });

  test("empty retrieval emits empty hits and notice in system prompt", async () => {
    const llm = new ScriptedLLM([[{ kind: "delta", text: "ok" }, { kind: "done", finishReason: "stop" }]]);
    const orchestrator = new AssistantOrchestrator({
      llmClient: llm,
      embedder: new StubEmbedder(),
      vectorIndex: new StubVectorIndex([]),
      model: "m",
      topK: 5,
      systemPromptHeader: "h",
      toolLoopMax: 5,
    });
    const events = await collect(orchestrator, "q");
    const retrieval = events.find((e) => e.kind === "retrieval");
    if (retrieval?.kind === "retrieval") {
      expect(retrieval.hits.length).toBe(0);
    }
    const req = llm.capturedRequests[0]!;
    expect(req.messages[0]?.content).toMatch(/контекст\s+пуст|нет\s+контекста|нет\s+документ/i);
  });

  test("citations are parsed from final text [N] markers", async () => {
    const llm = new ScriptedLLM([
      [
        { kind: "delta", text: "Видно в [1] и [2] также." },
        { kind: "done", finishReason: "stop" },
      ],
    ]);
    const orchestrator = new AssistantOrchestrator({
      llmClient: llm,
      embedder: new StubEmbedder(),
      vectorIndex: new StubVectorIndex([
        makeChunk("README.md", 1, 5, "alpha", 0.1),
        makeChunk("src/x.ts", 10, 20, "beta", 0.2),
        makeChunk("src/y.ts", 30, 40, "gamma", 0.3),
      ]),
      model: "m",
      topK: 5,
      systemPromptHeader: "h",
      toolLoopMax: 5,
    });
    const events = await collect(orchestrator, "q");
    const final = events.find((e) => e.kind === "final");
    expect(final?.kind).toBe("final");
    if (final?.kind === "final") {
      expect(final.citations.length).toBe(2);
      expect(final.citations[0]).toMatchObject({ label: 1, source: "README.md", lineStart: 1, lineEnd: 5 });
      expect(final.citations[1]).toMatchObject({ label: 2, source: "src/x.ts", lineStart: 10, lineEnd: 20 });
    }
  });

  test("citation [N] outside hit count is ignored gracefully", async () => {
    const llm = new ScriptedLLM([
      [
        { kind: "delta", text: "Ссылка на [99]" },
        { kind: "done", finishReason: "stop" },
      ],
    ]);
    const orchestrator = new AssistantOrchestrator({
      llmClient: llm,
      embedder: new StubEmbedder(),
      vectorIndex: new StubVectorIndex([makeChunk("README.md", 1, 5, "a", 0.1)]),
      model: "m",
      topK: 5,
      systemPromptHeader: "h",
      toolLoopMax: 5,
    });
    const events = await collect(orchestrator, "q");
    const final = events.find((e) => e.kind === "final");
    if (final?.kind === "final") {
      expect(final.citations.length).toBe(0);
    }
  });

  test("tool-loop: tool_call → tool_result → second turn → final", async () => {
    const toolCalls = [{ id: "call_1", name: "git_branch", arguments: "{}" }];
    const llm = new ScriptedLLM([
      [{ kind: "tool_call", calls: toolCalls }, { kind: "done", finishReason: "tool_calls" }],
      [
        { kind: "delta", text: "Вы на ветке master." },
        { kind: "done", finishReason: "stop" },
      ],
    ]);
    let executed = 0;
    const orchestrator = new AssistantOrchestrator({
      llmClient: llm,
      embedder: new StubEmbedder(),
      vectorIndex: new StubVectorIndex([]),
      model: "m",
      topK: 5,
      systemPromptHeader: "h",
      toolLoopMax: 5,
      tools: [{ name: "git_branch", description: "branch", parameters: { type: "object", properties: {} } }],
      toolExecutor: async (call) => {
        executed += 1;
        expect(call.name).toBe("git_branch");
        return { content: "master", isError: false };
      },
    });
    const events = await collect(orchestrator, "ветка?");
    expect(executed).toBe(1);
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("tool_call");
    expect(kinds).toContain("tool_result");
    const final = events.find((e) => e.kind === "final");
    expect(final?.kind).toBe("final");
    if (final?.kind === "final") {
      expect(final.text).toContain("master");
    }
    expect(llm.capturedRequests.length).toBe(2);
    const secondReq = llm.capturedRequests[1]!;
    expect(secondReq.messages.some((m) => m.role === "tool")).toBe(true);
  });

  test("tool-loop respects toolLoopMax (LLM keeps calling tools)", async () => {
    const callForever: Array<Array<any>> = [];
    for (let i = 0; i < 10; i++) {
      callForever.push([
        { kind: "tool_call", calls: [{ id: `c${i}`, name: "git_branch", arguments: "{}" }] },
        { kind: "done", finishReason: "tool_calls" },
      ]);
    }
    const llm = new ScriptedLLM(callForever);
    let executed = 0;
    const orchestrator = new AssistantOrchestrator({
      llmClient: llm,
      embedder: new StubEmbedder(),
      vectorIndex: new StubVectorIndex([]),
      model: "m",
      topK: 5,
      systemPromptHeader: "h",
      toolLoopMax: 3,
      tools: [{ name: "git_branch", description: "b", parameters: { type: "object", properties: {} } }],
      toolExecutor: async () => {
        executed += 1;
        return { content: "main", isError: false };
      },
    });
    await collect(orchestrator, "q");
    expect(executed).toBe(3);
  });

  test("tool error is propagated as tool_result with isError=true", async () => {
    const llm = new ScriptedLLM([
      [{ kind: "tool_call", calls: [{ id: "c", name: "broken", arguments: "{}" }] }, { kind: "done", finishReason: "tool_calls" }],
      [{ kind: "delta", text: "ok" }, { kind: "done", finishReason: "stop" }],
    ]);
    const orchestrator = new AssistantOrchestrator({
      llmClient: llm,
      embedder: new StubEmbedder(),
      vectorIndex: new StubVectorIndex([]),
      model: "m",
      topK: 5,
      systemPromptHeader: "h",
      toolLoopMax: 5,
      tools: [{ name: "broken", description: "b", parameters: { type: "object", properties: {} } }],
      toolExecutor: async () => ({ content: "boom", isError: true }),
    });
    const events = await collect(orchestrator, "q");
    const result = events.find((e) => e.kind === "tool_result");
    expect(result?.kind).toBe("tool_result");
    if (result?.kind === "tool_result") {
      expect(result.isError).toBe(true);
      expect(result.result).toBe("boom");
    }
  });

  test("tools[] are forwarded to llmClient.stream", async () => {
    const llm = new ScriptedLLM([[{ kind: "done", finishReason: "stop" }]]);
    const tools = [
      { name: "git_branch", description: "b", parameters: { type: "object", properties: {} } },
      { name: "list_files", description: "l", parameters: { type: "object", properties: {} } },
    ];
    const orchestrator = new AssistantOrchestrator({
      llmClient: llm,
      embedder: new StubEmbedder(),
      vectorIndex: new StubVectorIndex([]),
      model: "m",
      topK: 5,
      systemPromptHeader: "h",
      toolLoopMax: 5,
      tools,
      toolExecutor: async () => ({ content: "", isError: false }),
    });
    await collect(orchestrator, "q");
    expect(llm.capturedRequests[0]!.tools).toEqual(tools);
  });

  test("topK is forwarded to vectorIndex.search", async () => {
    let receivedK: number | undefined;
    const vi: VectorIndex = {
      upsert() {},
      search(_v: Float32Array, k: number) {
        receivedK = k;
        return [];
      },
      deleteByStrategy() {
        return 0;
      },
      countByStrategy() {
        return 0;
      },
    };
    const llm = new ScriptedLLM([[{ kind: "done", finishReason: "stop" }]]);
    const orchestrator = new AssistantOrchestrator({
      llmClient: llm,
      embedder: new StubEmbedder(),
      vectorIndex: vi,
      model: "m",
      topK: 7,
      systemPromptHeader: "h",
      toolLoopMax: 5,
    });
    await collect(orchestrator, "q");
    expect(receivedK).toBe(7);
  });
});
