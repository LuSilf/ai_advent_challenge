import { describe, test, expect } from "bun:test";

import { formatRagErrorBlock, formatRagTechBlock } from "./rag-formatter";
import type { RagRetrieveResult } from "../../domain/services/rag-service";

function okResult(): RagRetrieveResult {
  return {
    status: "ok",
    strategy: "structural",
    topK: 5,
    promptSuffix: "ctx",
    hits: [
      {
        id: 1,
        strategy: "structural",
        source: "primer.md",
        title: "Primer",
        section: "Cache > When to update the cache",
        chunkIndex: 0,
        charStart: 0,
        charEnd: 100,
        text: "Write-through writes to cache and backing store immediately.",
        distance: 0.1234,
      },
    ],
  };
}

describe("formatRagTechBlock", () => {
  test("formats retrieved hits with source, section and distance", () => {
    const block = formatRagTechBlock(okResult());
    expect(block).toContain("найдено 1 чанков");
    expect(block).toContain("primer.md | Cache > When to update the cache | distance=0.1234");
    expect(block).toContain("Write-through writes to cache and backing store immediately.");
  });

  test("formats no_index fallback message", () => {
    const block = formatRagTechBlock({
      status: "no_index",
      strategy: "structural",
      topK: 5,
      hits: [],
    });

    expect(block).toContain("retrieval unavailable");
    expect(block).toContain("не найден");
    expect(block).toContain("без RAG");
  });

  test("formats no_hits fallback message", () => {
    const block = formatRagTechBlock({
      status: "no_hits",
      strategy: "structural",
      topK: 5,
      hits: [],
    });

    expect(block).toContain("retrieval empty");
    expect(block).toContain("ничего не найдено");
    expect(block).toContain("без RAG");
  });

  test("formats insufficient_context message", () => {
    const block = formatRagTechBlock({
      status: "insufficient_context",
      strategy: "structural",
      topK: 3,
      hits: [],
    });

    expect(block).toContain("insufficient context");
    expect(block).toContain("нерелевантные");
  });
});

describe("formatRagErrorBlock", () => {
  test("formats retrieval error as fallback block", () => {
    const block = formatRagErrorBlock("network timeout");
    expect(block).toContain("retrieval error");
    expect(block).toContain("network timeout");
    expect(block).toContain("без RAG");
  });
});
