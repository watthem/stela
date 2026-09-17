import { createHash } from "node:crypto";
import type { SourceProvenance, Strategy } from "./types.js";

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function byteRange(
  source: string,
  chunk: string,
  searchFrom = 0,
): { start: number; end: number } {
  const buf = Buffer.from(source);
  const chunkBuf = Buffer.from(chunk);
  const start = buf.indexOf(chunkBuf, searchFrom);
  if (start === -1) return { start: -1, end: -1 };
  return { start, end: start + chunkBuf.length };
}

export function createProvenance(
  file: string,
  text: string,
  fullSource: string,
  strategy: Strategy,
  searchFrom: number,
  heading?: { text: string; level: number },
): SourceProvenance {
  const range = byteRange(fullSource, text, searchFrom);
  return {
    file,
    byteStart: range.start,
    byteEnd: range.end,
    contentHash: contentHash(text),
    strategy,
    ...(heading && { heading: heading.text, headingLevel: heading.level }),
  };
}
