import type { Strategy } from "./types.js";

export interface ChunkSpan {
  text: string;
  /** UTF-16 code-unit offset in the original, unnormalized string. */
  charStart: number;
}

function addTrimmedSegment(source: string, start: number, end: number, results: ChunkSpan[]): void {
  const segment = source.slice(start, end);
  const left = segment.trimStart();
  const text = left.trimEnd();
  if (text) results.push({ text, charStart: start + segment.length - left.length });
}

export function assertWordLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new RangeError("word limit must be a positive safe integer");
  }
}

export function splitByHeading(text: string): string[] { return splitByHeadingWithOffsets(text).map(s => s.text); }
export function splitByParagraph(text: string): string[] { return splitByParagraphWithOffsets(text).map(s => s.text); }
export function splitBySentence(text: string): string[] { return splitBySentenceWithOffsets(text).map(s => s.text); }
export function splitByWord(text: string, maxWords = 256): string[] { return splitByWordWithOffsets(text, maxWords).map(s => s.text); }
/** @deprecated Counts whitespace-delimited words, not model tokens. Use splitByWord. */
export function splitByToken(text: string, maxTokens = 256): string[] { return splitByWord(text, maxTokens); }
export function split(text: string, strategy: Strategy, maxWords?: number): string[] {
  return splitWithOffsets(text, strategy, maxWords).map(s => s.text);
}

const legalHeading = /^ {0,3}(?:(?:article|section)\s+(?:[ivx]+|\d+(?:\.\d+)*)\b|(?:exhibit|schedule)\s+[a-z0-9]|(?:recitals|preamble|whereas)\s*$)/i;

/** ATX headings and legal section headings outside backtick/tilde fences; source positions are retained. */
export function splitByHeadingWithOffsets(source: string): ChunkSpan[] {
  const results: ChunkSpan[] = [];
  const positions: number[] = [];
  let fence: { marker: string; length: number } | undefined;
  for (const match of source.matchAll(/[^\r\n]+|\r\n|[\r\n]/g)) {
    const line = match[0];
    if (/^[\r\n]/.test(line)) continue;
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence.marker && marker[1].length >= fence.length && /^[ \t]*$/.test(marker[2])) fence = undefined;
      continue;
    }
    if (marker && (marker[1][0] !== "`" || !marker[2].includes("`"))) {
      fence = { marker: marker[1][0], length: marker[1].length };
      continue;
    }
    if (/^ {0,3}#{1,6}(?:[ \t]+|$)/.test(line) || legalHeading.test(line)) positions.push(match.index!);
  }
  if (positions.length === 0) addTrimmedSegment(source, 0, source.length, results);
  else {
    addTrimmedSegment(source, 0, positions[0], results);
    for (let i = 0; i < positions.length; i++) {
      addTrimmedSegment(source, positions[i], positions[i + 1] ?? source.length, results);
    }
  }
  return results;
}

export function splitByParagraphWithOffsets(source: string): ChunkSpan[] {
  const results: ChunkSpan[] = [];
  const separators = /(?:\r\n|\n|\r(?!\n))(?:[ \t]*(?:\r\n|\n|\r(?!\n)))+/g;
  let start = 0;
  for (const match of source.matchAll(separators)) {
    addTrimmedSegment(source, start, match.index!, results);
    start = match.index! + match[0].length;
  }
  addTrimmedSegment(source, start, source.length, results);
  return results;
}

const sentences = new Intl.Segmenter("en", { granularity: "sentence" });
// ICU separates titles before capitalized names; retain these with the next segment.
const trailingTitle = /\b(?:Dr|Mr|Mrs|Ms|Prof|Rev|Sr|Jr|St)\.\s*$/i;
export function splitBySentenceWithOffsets(source: string): ChunkSpan[] {
  const results: ChunkSpan[] = [];
  let start = 0;
  for (const part of sentences.segment(source)) {
    const end = part.index + part.segment.length;
    if (end < source.length && trailingTitle.test(part.segment)) continue;
    addTrimmedSegment(source, start, end, results);
    start = end;
  }
  addTrimmedSegment(source, start, source.length, results);
  return results;
}

export function splitByWordWithOffsets(source: string, maxWords = 256): ChunkSpan[] {
  assertWordLimit(maxWords);
  const results: ChunkSpan[] = [];
  let start = 0;
  let end = 0;
  let count = 0;
  for (const word of source.matchAll(/\S+/g)) {
    if (count === 0) start = word.index!;
    end = word.index! + word[0].length;
    if (++count === maxWords) {
      results.push({ text: source.slice(start, end), charStart: start });
      count = 0;
    }
  }
  if (count) results.push({ text: source.slice(start, end), charStart: start });
  return results;
}
/** @deprecated Word-count compatibility alias. */
export const splitByTokenWithOffsets = splitByWordWithOffsets;

export function splitWithOffsets(source: string, strategy: Strategy, maxWords?: number): ChunkSpan[] {
  if (maxWords !== undefined) {
    assertWordLimit(maxWords);
    if (strategy !== "word" && strategy !== "token") throw new TypeError("word limit requires the word strategy");
  }
  switch (strategy) {
    case "heading": return splitByHeadingWithOffsets(source);
    case "paragraph": return splitByParagraphWithOffsets(source);
    case "sentence": return splitBySentenceWithOffsets(source);
    case "word":
    case "token": return splitByWordWithOffsets(source, maxWords);
    default: throw new TypeError(`unknown strategy: ${String(strategy)}`);
  }
}
