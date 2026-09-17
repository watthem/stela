import { createHash } from "node:crypto";
import type { SourceProvenance, Strategy } from "./types.js";

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Build an array that maps character (UTF-16 code-unit) index → UTF-8
 * byte offset.  O(n) build, O(1) lookup.
 */
export function buildCharToByteMap(source: string): Uint32Array {
  const len = source.length;
  const map = new Uint32Array(len + 1);
  let byteOffset = 0;
  for (let i = 0; i < len; i++) {
    map[i] = byteOffset;
    const code = source.charCodeAt(i);
    if (code <= 0x7f) {
      byteOffset += 1;
    } else if (code <= 0x7ff) {
      byteOffset += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // High surrogate of a pair — 4 bytes in UTF-8.
      byteOffset += 4;
      i++;
      if (i < len) map[i] = byteOffset;
    } else {
      byteOffset += 3;
    }
  }
  map[len] = byteOffset;
  return map;
}

/* ── Legacy helpers (kept for public API) ────────────────────────────── */

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
