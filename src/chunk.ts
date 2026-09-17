import type { Strategy } from "./types.js";

/* ── Offset-aware chunk span ─────────────────────────────────────────── */

export interface ChunkSpan {
  text: string;
  /** Character (UTF-16 code-unit) offset within the source string. */
  charStart: number;
}

/**
 * Trim whitespace from source[start..end] and push the result.
 * Uses charCode checks for ASCII whitespace (covers all whitespace found
 * in markdown: space, tab, LF, VT, FF, CR).
 */
function addTrimmedSegment(
  source: string,
  start: number,
  end: number,
  results: ChunkSpan[],
): void {
  let tStart = start;
  while (tStart < end && source.charCodeAt(tStart) <= 0x20) tStart++;
  let tEnd = end;
  while (tEnd > tStart && source.charCodeAt(tEnd - 1) <= 0x20) tEnd--;
  if (tStart < tEnd) {
    results.push({ text: source.substring(tStart, tEnd), charStart: tStart });
  }
}

/* ── Legacy text-only split functions (public API) ───────────────────── */

export function splitByHeading(text: string): string[] {
  return splitByHeadingWithOffsets(text).map((s) => s.text);
}

export function splitByParagraph(text: string): string[] {
  return splitByParagraphWithOffsets(text).map((s) => s.text);
}

export function splitBySentence(text: string): string[] {
  return splitBySentenceWithOffsets(text).map((s) => s.text);
}

export function splitByToken(text: string, maxTokens = 256): string[] {
  return splitByTokenWithOffsets(text, maxTokens).map((s) => s.text);
}

export function split(text: string, strategy: Strategy, maxTokens?: number): string[] {
  return splitWithOffsets(text, strategy, maxTokens).map((s) => s.text);
}

/* ── Offset-aware split functions (used by optimised pipeline) ──────── */

export function splitByHeadingWithOffsets(source: string): ChunkSpan[] {
  const results: ChunkSpan[] = [];
  const headingRegex = /^#{1,6}\s+.+$/gm;
  const positions: number[] = [];
  let match: RegExpExecArray | null;

  while ((match = headingRegex.exec(source)) !== null) {
    positions.push(match.index);
  }

  if (positions.length === 0) {
    addTrimmedSegment(source, 0, source.length, results);
    return results;
  }

  // Content before the first heading.
  if (positions[0] > 0) {
    addTrimmedSegment(source, 0, positions[0], results);
  }

  for (let i = 0; i < positions.length; i++) {
    const start = positions[i];
    const end = i + 1 < positions.length ? positions[i + 1] : source.length;
    addTrimmedSegment(source, start, end, results);
  }

  return results;
}

export function splitByParagraphWithOffsets(source: string): ChunkSpan[] {
  const results: ChunkSpan[] = [];
  const sepRegex = /\n{2,}/g;
  let segStart = 0;
  let match: RegExpExecArray | null;

  while ((match = sepRegex.exec(source)) !== null) {
    addTrimmedSegment(source, segStart, match.index, results);
    segStart = match.index + match[0].length;
  }
  addTrimmedSegment(source, segStart, source.length, results);
  return results;
}

export function splitBySentenceWithOffsets(source: string): ChunkSpan[] {
  const results: ChunkSpan[] = [];
  const sepRegex = /(?<=[.!?])\s+/g;
  let segStart = 0;
  let match: RegExpExecArray | null;

  while ((match = sepRegex.exec(source)) !== null) {
    addTrimmedSegment(source, segStart, match.index, results);
    segStart = match.index + match[0].length;
  }
  addTrimmedSegment(source, segStart, source.length, results);
  return results;
}

export function splitByTokenWithOffsets(source: string, maxTokens = 256): ChunkSpan[] {
  // Slice by word offsets so every chunk is a verbatim substring of source.
  const words = [...source.matchAll(/\S+/g)];
  const results: ChunkSpan[] = [];

  for (let i = 0; i < words.length; i += maxTokens) {
    const first = words[i];
    const last = words[Math.min(i + maxTokens, words.length) - 1];
    const charStart = first.index!;
    const charEnd = last.index! + last[0].length;
    results.push({ text: source.slice(charStart, charEnd), charStart });
  }
  return results;
}

export function splitWithOffsets(
  source: string,
  strategy: Strategy,
  maxTokens?: number,
): ChunkSpan[] {
  switch (strategy) {
    case "heading":
      return splitByHeadingWithOffsets(source);
    case "paragraph":
      return splitByParagraphWithOffsets(source);
    case "sentence":
      return splitBySentenceWithOffsets(source);
    case "token":
      return splitByTokenWithOffsets(source, maxTokens);
  }
}
