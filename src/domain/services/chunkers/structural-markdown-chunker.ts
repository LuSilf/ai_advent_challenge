import type { Chunker } from "../../ports/chunker";
import type { Chunk } from "../../models/chunking";

export type StructuralMarkdownChunkerConfig = {
  primaryLevel: number;
  splitLevel: number;
  maxSize: number;
};

type Header = {
  level: number;
  title: string;
  lineStart: number;
};

type Range = {
  start: number;
  end: number;
  section: string | null;
};

const HEADER_REGEX = /^(#{1,6})[ \t]+(.+?)\s*$/gm;

export class StructuralMarkdownChunker implements Chunker {
  constructor(private readonly config: StructuralMarkdownChunkerConfig) {
    if (config.primaryLevel <= 0 || config.primaryLevel > 6) {
      throw new Error(`primaryLevel must be 1..6, got ${config.primaryLevel}`);
    }
    if (config.splitLevel <= config.primaryLevel || config.splitLevel > 6) {
      throw new Error(
        `splitLevel must be > primaryLevel and <= 6 (got ${config.splitLevel} vs ${config.primaryLevel})`
      );
    }
    if (config.maxSize <= 0) {
      throw new Error(`maxSize must be > 0, got ${config.maxSize}`);
    }
  }

  chunk(text: string, source: string): Chunk[] {
    if (text.length === 0) return [];

    const headers = scanHeaders(text);
    const title = findTitle(headers, text);

    const primary = headers.filter((h) => h.level === this.config.primaryLevel);

    let ranges: Range[];
    if (primary.length === 0) {
      ranges = [{ start: 0, end: text.length, section: null }];
    } else {
      ranges = [];
      if (primary[0]!.lineStart > 0) {
        ranges.push({ start: 0, end: primary[0]!.lineStart, section: null });
      }
      for (let i = 0; i < primary.length; i++) {
        const h = primary[i]!;
        const nextStart = i + 1 < primary.length ? primary[i + 1]!.lineStart : text.length;
        ranges.push({ start: h.lineStart, end: nextStart, section: h.title });
      }
    }

    const finalRanges: Range[] = [];
    for (const range of ranges) {
      if (range.end - range.start <= this.config.maxSize) {
        finalRanges.push(range);
        continue;
      }
      const afterStructural = splitByLevel(range, headers, this.config.splitLevel);
      for (const sub of afterStructural) {
        if (sub.end - sub.start <= this.config.maxSize) {
          finalRanges.push(sub);
        } else {
          finalRanges.push(...hardCut(sub, this.config.maxSize));
        }
      }
    }

    const chunks: Chunk[] = [];
    let chunkIndex = 0;
    for (const range of finalRanges) {
      const sliced = text.slice(range.start, range.end);
      if (sliced.trim().length === 0) continue;
      chunks.push({
        strategy: "structural",
        source,
        title,
        section: range.section,
        chunkIndex,
        charStart: range.start,
        charEnd: range.end,
        text: sliced,
      });
      chunkIndex += 1;
    }
    return chunks;
  }
}

function scanHeaders(text: string): Header[] {
  const headers: Header[] = [];
  HEADER_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HEADER_REGEX.exec(text)) !== null) {
    headers.push({
      level: match[1]!.length,
      title: match[2]!.trim(),
      lineStart: match.index,
    });
  }
  return headers;
}

function findTitle(headers: Header[], _text: string): string | null {
  const h1 = headers.find((h) => h.level === 1);
  return h1 ? h1.title : null;
}

function hardCut(range: Range, maxSize: number): Range[] {
  const pieces: Range[] = [];
  let cursor = range.start;
  while (cursor < range.end) {
    const end = Math.min(cursor + maxSize, range.end);
    pieces.push({ start: cursor, end, section: range.section });
    cursor = end;
  }
  return pieces;
}

function splitByLevel(range: Range, headers: Header[], splitLevel: number): Range[] {
  const inner = headers.filter(
    (h) => h.level === splitLevel && h.lineStart >= range.start && h.lineStart < range.end
  );
  if (inner.length === 0) {
    return [range];
  }

  const subs: Range[] = [];
  if (inner[0]!.lineStart > range.start) {
    subs.push({ start: range.start, end: inner[0]!.lineStart, section: range.section });
  }
  for (let i = 0; i < inner.length; i++) {
    const h = inner[i]!;
    const nextEnd = i + 1 < inner.length ? inner[i + 1]!.lineStart : range.end;
    const breadcrumb = range.section ? `${range.section} > ${h.title}` : h.title;
    subs.push({ start: h.lineStart, end: nextEnd, section: breadcrumb });
  }
  return subs;
}
