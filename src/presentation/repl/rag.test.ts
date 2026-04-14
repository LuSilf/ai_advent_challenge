import { describe, test, expect } from "bun:test";

import { prepareRagPrompt, readRagState, persistRagState, formatRagStatusLine, type RagRuntimeState, DEFAULT_RAG_STRATEGY, DEFAULT_RAG_TOP_K } from "./rag";
import type { RagRetrieveResult, RagRetriever } from "../../domain/services/rag-service";

class FakeOptionsRepo {
  private readonly values = new Map<string, string>();

  get(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  set(key: string, value: string): void {
    this.values.set(key, value);
  }

  getAll(): Array<{ key: string; value: string }> {
    return [...this.values.entries()].map(([key, value]) => ({ key, value }));
  }
}

class FakeRetriever implements RagRetriever {
  public calls: Array<{ question: string; strategy: string; topK: number }> = [];

  constructor(private readonly result: RagRetrieveResult) {}

  async retrieve(question: string, options: { strategy: any; topK: number }): Promise<RagRetrieveResult> {
    this.calls.push({ question, strategy: options.strategy, topK: options.topK });
    return this.result;
  }
}

function ragState(overrides: Partial<RagRuntimeState> = {}): RagRuntimeState {
  return {
    enabled: false,
    strategy: DEFAULT_RAG_STRATEGY,
    topK: DEFAULT_RAG_TOP_K,
    ...overrides,
  };
}

describe("RAG state helpers", () => {
  test("readRagState returns defaults when options are absent", () => {
    const repo = new FakeOptionsRepo();
    expect(readRagState(repo as any)).toEqual({
      enabled: false,
      strategy: "structural",
      topK: 5,
    });
  });

  test("persistRagState writes values that can be read back", () => {
    const repo = new FakeOptionsRepo();
    persistRagState(repo as any, {
      enabled: true,
      strategy: "fixed",
      topK: 7,
    });

    expect(readRagState(repo as any)).toEqual({
      enabled: true,
      strategy: "fixed",
      topK: 7,
    });
  });

  test("formatRagStatusLine shows enabled flag and tuning", () => {
    expect(formatRagStatusLine(ragState({ enabled: true, strategy: "fixed", topK: 7 }))).toBe(
      "RAG: on | strategy: fixed | topK: 7",
    );
  });
});

describe("prepareRagPrompt", () => {
  test("returns existing suffix unchanged when rag is disabled", async () => {
    const result = await prepareRagPrompt("what is cache-aside?", ragState(), undefined, "task reminder");

    expect(result.userPromptSuffix).toBe("task reminder");
    expect(result.notice).toBeUndefined();
    expect(result.retrieval).toBeUndefined();
  });

  test("combines existing suffix with retrieved context when rag succeeds", async () => {
    const retriever = new FakeRetriever({
      status: "ok",
      strategy: "structural",
      topK: 5,
      hits: [],
      promptSuffix: "retrieved context",
    });

    const result = await prepareRagPrompt(
      "what is cache-aside?",
      ragState({ enabled: true }),
      retriever,
      "task reminder",
    );

    expect(retriever.calls).toEqual([
      { question: "what is cache-aside?", strategy: "structural", topK: 5 },
    ]);
    expect(result.userPromptSuffix).toBe("task reminder\n\nretrieved context");
    expect(result.notice).toBeUndefined();
    expect(result.retrieval?.status).toBe("ok");
  });

  test("returns fallback notice when index is missing", async () => {
    const retriever = new FakeRetriever({
      status: "no_index",
      strategy: "structural",
      topK: 5,
      hits: [],
    });

    const result = await prepareRagPrompt(
      "what is cache-aside?",
      ragState({ enabled: true }),
      retriever,
    );

    expect(result.userPromptSuffix).toBeUndefined();
    expect(result.notice).toContain("не найден");
    expect(result.retrieval?.status).toBe("no_index");
  });

  test("returns fallback notice when retrieval finds no hits", async () => {
    const retriever = new FakeRetriever({
      status: "no_hits",
      strategy: "structural",
      topK: 5,
      hits: [],
    });

    const result = await prepareRagPrompt(
      "what is cache-aside?",
      ragState({ enabled: true }),
      retriever,
    );

    expect(result.userPromptSuffix).toBeUndefined();
    expect(result.notice).toContain("ничего не найдено");
    expect(result.retrieval?.status).toBe("no_hits");
  });
});
