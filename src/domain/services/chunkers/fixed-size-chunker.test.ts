import { describe, test, expect } from "bun:test";
import { FixedSizeChunker } from "./fixed-size-chunker";

describe("FixedSizeChunker", () => {
  test("empty input produces no chunks", () => {
    const chunker = new FixedSizeChunker({ size: 100, overlap: 10 });
    expect(chunker.chunk("", "test.md")).toEqual([]);
  });

  test("input shorter than size produces a single chunk", () => {
    const chunker = new FixedSizeChunker({ size: 100, overlap: 10 });
    const text = "short text";
    const chunks = chunker.chunk(text, "test.md");

    expect(chunks.length).toBe(1);
    expect(chunks[0]!.text).toBe(text);
    expect(chunks[0]!.charStart).toBe(0);
    expect(chunks[0]!.charEnd).toBe(text.length);
    expect(chunks[0]!.chunkIndex).toBe(0);
    expect(chunks[0]!.strategy).toBe("fixed");
    expect(chunks[0]!.source).toBe("test.md");
    expect(chunks[0]!.section).toBeNull();
  });

  test("input of exactly size produces one full chunk", () => {
    const chunker = new FixedSizeChunker({ size: 10, overlap: 2 });
    const text = "0123456789";
    const chunks = chunker.chunk(text, "t.md");
    expect(chunks.length).toBe(1);
    expect(chunks[0]!.text).toBe(text);
    expect(chunks[0]!.charEnd).toBe(10);
  });

  test("sliding window respects step = size - overlap", () => {
    const chunker = new FixedSizeChunker({ size: 10, overlap: 3 });
    const text = "0123456789ABCDEFGHIJ";
    const chunks = chunker.chunk(text, "t.md");

    expect(chunks.length).toBe(3);
    expect(chunks[0]!.charStart).toBe(0);
    expect(chunks[0]!.charEnd).toBe(10);
    expect(chunks[1]!.charStart).toBe(7);
    expect(chunks[1]!.charEnd).toBe(17);
    expect(chunks[2]!.charStart).toBe(14);
    expect(chunks[2]!.charEnd).toBe(20);
  });

  test("consecutive chunks overlap by the configured amount", () => {
    const chunker = new FixedSizeChunker({ size: 10, overlap: 4 });
    const text = "abcdefghijklmnopqrstuvwxyz";
    const chunks = chunker.chunk(text, "t.md");

    for (let i = 0; i < chunks.length - 1; i++) {
      const a = chunks[i]!;
      const b = chunks[i + 1]!;
      const overlapChars = a.charEnd - b.charStart;
      expect(overlapChars).toBeGreaterThanOrEqual(4);
    }
  });

  test("chunkIndex is sequential starting at zero", () => {
    const chunker = new FixedSizeChunker({ size: 5, overlap: 1 });
    const chunks = chunker.chunk("abcdefghijklmnop", "t.md");
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i]!.chunkIndex).toBe(i);
    }
  });

  test("title is extracted from the first H1 line", () => {
    const chunker = new FixedSizeChunker({ size: 100, overlap: 10 });
    const text = "Some intro\n# My Title\nmore text here";
    const chunks = chunker.chunk(text, "t.md");
    expect(chunks[0]!.title).toBe("My Title");
  });

  test("title is null when document has no H1", () => {
    const chunker = new FixedSizeChunker({ size: 100, overlap: 10 });
    const chunks = chunker.chunk("no title here\njust body", "t.md");
    expect(chunks[0]!.title).toBeNull();
  });

  test("constructor rejects overlap >= size", () => {
    expect(() => new FixedSizeChunker({ size: 10, overlap: 10 })).toThrow();
    expect(() => new FixedSizeChunker({ size: 10, overlap: 15 })).toThrow();
  });

  test("constructor rejects non-positive size", () => {
    expect(() => new FixedSizeChunker({ size: 0, overlap: 0 })).toThrow();
    expect(() => new FixedSizeChunker({ size: -5, overlap: 0 })).toThrow();
  });

  test("chunks cover the entire input without gaps", () => {
    const chunker = new FixedSizeChunker({ size: 7, overlap: 2 });
    const text = "the quick brown fox jumps over the lazy dog";
    const chunks = chunker.chunk(text, "t.md");

    expect(chunks[0]!.charStart).toBe(0);
    expect(chunks[chunks.length - 1]!.charEnd).toBe(text.length);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.charStart).toBeLessThan(chunks[i - 1]!.charEnd);
    }
  });
});
