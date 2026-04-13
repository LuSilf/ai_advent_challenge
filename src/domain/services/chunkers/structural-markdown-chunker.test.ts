import { describe, test, expect } from "bun:test";
import { StructuralMarkdownChunker } from "./structural-markdown-chunker";

const cfg = { primaryLevel: 2, splitLevel: 3, maxSize: 200 };

describe("StructuralMarkdownChunker", () => {
  test("empty input produces no chunks", () => {
    const chunker = new StructuralMarkdownChunker(cfg);
    expect(chunker.chunk("", "t.md")).toEqual([]);
  });

  test("document without headers yields a single chunk with null section", () => {
    const chunker = new StructuralMarkdownChunker(cfg);
    const text = "just a plain paragraph with no structure whatsoever.";
    const chunks = chunker.chunk(text, "t.md");
    expect(chunks.length).toBe(1);
    expect(chunks[0]!.text).toBe(text);
    expect(chunks[0]!.section).toBeNull();
    expect(chunks[0]!.title).toBeNull();
    expect(chunks[0]!.charStart).toBe(0);
    expect(chunks[0]!.charEnd).toBe(text.length);
  });

  test("H1 becomes the title of every chunk", () => {
    const chunker = new StructuralMarkdownChunker(cfg);
    const text = "# Big Doc\n\nintro\n\n## Alpha\n\nbody\n\n## Beta\n\nbody";
    const chunks = chunker.chunk(text, "t.md");
    for (const c of chunks) {
      expect(c.title).toBe("Big Doc");
    }
  });

  test("H1 + two H2 sections produce one preamble + two section chunks", () => {
    const chunker = new StructuralMarkdownChunker(cfg);
    const text = "# Doc\n\nintro paragraph\n\n## Alpha\n\nalpha body text\n\n## Beta\n\nbeta body text";
    const chunks = chunker.chunk(text, "t.md");

    expect(chunks.length).toBe(3);
    expect(chunks[0]!.section).toBeNull();
    expect(chunks[0]!.text).toContain("intro paragraph");
    expect(chunks[1]!.section).toBe("Alpha");
    expect(chunks[1]!.text).toContain("alpha body text");
    expect(chunks[2]!.section).toBe("Beta");
    expect(chunks[2]!.text).toContain("beta body text");
  });

  test("empty preamble is not emitted", () => {
    const chunker = new StructuralMarkdownChunker(cfg);
    const text = "## Alpha\n\nalpha body";
    const chunks = chunker.chunk(text, "t.md");
    expect(chunks.length).toBe(1);
    expect(chunks[0]!.section).toBe("Alpha");
  });

  test("section larger than maxSize with H3 inside is split by H3 with breadcrumb", () => {
    const big = "x".repeat(150);
    const text =
      `## Big\n\n` +
      `${big}\n\n` +
      `### Sub1\n\n${big}\n\n` +
      `### Sub2\n\n${big}\n`;
    const chunker = new StructuralMarkdownChunker({ primaryLevel: 2, splitLevel: 3, maxSize: 200 });
    const chunks = chunker.chunk(text, "t.md");

    expect(chunks.length).toBeGreaterThanOrEqual(3);
    const sections = chunks.map((c) => c.section);
    expect(sections).toContain("Big");
    expect(sections).toContain("Big > Sub1");
    expect(sections).toContain("Big > Sub2");
  });

  test("section larger than maxSize without any H3 is hard-cut into maxSize pieces with same section", () => {
    const big = "y".repeat(500);
    const text = `## Huge\n\n${big}`;
    const chunker = new StructuralMarkdownChunker({ primaryLevel: 2, splitLevel: 3, maxSize: 200 });
    const chunks = chunker.chunk(text, "t.md");

    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.section).toBe("Huge");
      expect(c.text.length).toBeLessThanOrEqual(200);
    }
  });

  test("oversized preamble before first H2 is hard-cut as well", () => {
    const long = "z".repeat(800);
    const text = `${long}\n\n## Alpha\n\nalpha body`;
    const chunker = new StructuralMarkdownChunker({ primaryLevel: 2, splitLevel: 3, maxSize: 200 });
    const chunks = chunker.chunk(text, "t.md");

    const preambleChunks = chunks.filter((c) => c.section === null);
    expect(preambleChunks.length).toBeGreaterThan(1);
    for (const c of preambleChunks) {
      expect(c.text.length).toBeLessThanOrEqual(200);
    }
  });

  test("char_start and char_end match original offsets", () => {
    const chunker = new StructuralMarkdownChunker(cfg);
    const text = "# Doc\n\n## Alpha\n\nalpha body\n\n## Beta\n\nbeta body";
    const chunks = chunker.chunk(text, "t.md");

    for (const c of chunks) {
      expect(text.slice(c.charStart, c.charEnd)).toBe(c.text);
    }
  });

  test("chunkIndex is sequential starting at zero", () => {
    const chunker = new StructuralMarkdownChunker(cfg);
    const text = "# Doc\n\n## A\n\naaa\n\n## B\n\nbbb\n\n## C\n\nccc";
    const chunks = chunker.chunk(text, "t.md");
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i]!.chunkIndex).toBe(i);
    }
  });

  test("strategy is 'structural' on all emitted chunks", () => {
    const chunker = new StructuralMarkdownChunker(cfg);
    const text = "# T\n\n## A\n\nalpha";
    for (const c of chunker.chunk(text, "t.md")) {
      expect(c.strategy).toBe("structural");
    }
  });

  test("constructor rejects invalid levels", () => {
    expect(() => new StructuralMarkdownChunker({ primaryLevel: 0, splitLevel: 2, maxSize: 100 })).toThrow();
    expect(() => new StructuralMarkdownChunker({ primaryLevel: 2, splitLevel: 2, maxSize: 100 })).toThrow();
    expect(() => new StructuralMarkdownChunker({ primaryLevel: 2, splitLevel: 3, maxSize: 0 })).toThrow();
  });
});
