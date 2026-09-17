import { hash as cryptoHash } from "node:crypto";
import { isUtf8 } from "node:buffer";
import type { SourceProvenance, Strategy } from "./types.js";

export function contentHash(text: string | Uint8Array): string {
  return cryptoHash("sha256", text, "hex");
}

/** Reject lossy decoding; offsets always refer to these exact UTF-8 bytes. */
export function decodeSource(input: string | Buffer): { text: string; bytes: Buffer } {
  if (typeof input !== "string" && !Buffer.isBuffer(input)) {
    throw new TypeError("source must be a string or Buffer");
  }
  if (typeof input === "string" && !input.isWellFormed()) {
    throw new TypeError("source contains an unpaired UTF-16 surrogate");
  }
  const bytes = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  if (!isUtf8(bytes)) throw new TypeError("source must be valid UTF-8; unsupported or malformed encoding");
  if (bytes.subarray(0, 5).toString("ascii") === "%PDF-" ||
      bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) || bytes.includes(0)) {
    throw new TypeError("binary document input is unsupported; provide extracted UTF-8 text");
  }
  // Buffer decoding retains a UTF-8 BOM, so it remains part of the byte map.
  return { text: typeof input === "string" ? input : bytes.toString("utf8"), bytes };
}

/** O(n) UTF-16-code-unit to UTF-8 offset map. Never split a surrogate pair. */
export function buildCharToByteMap(source: string): Uint32Array {
  const map = new Uint32Array(source.length + 1);
  let byteOffset = 0;
  for (let i = 0; i < source.length; i++) {
    map[i] = byteOffset;
    const code = source.charCodeAt(i);
    const next = source.charCodeAt(i + 1);
    if (code <= 0x7f) byteOffset++;
    else if (code <= 0x7ff) byteOffset += 2;
    else if (code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      // Interior code-unit boundary is not a valid UTF-8 slicing boundary.
      map[++i] = byteOffset;
      byteOffset += 4;
    } else byteOffset += 3; // Includes replacement encoding of lone surrogates.
    if (byteOffset > 0xffffffff) throw new RangeError("source exceeds supported byte range");
  }
  map[source.length] = byteOffset;
  return map;
}

export function byteRange(source: string, chunk: string, searchFrom = 0): { start: number; end: number } {
  const buf = Buffer.from(source);
  const chunkBuf = Buffer.from(chunk);
  const start = buf.indexOf(chunkBuf, searchFrom);
  return start === -1 ? { start: -1, end: -1 } : { start, end: start + chunkBuf.length };
}

export function createProvenance(
  file: string, text: string, fullSource: string, strategy: Strategy, searchFrom: number,
  heading?: { text: string; level: number },
): SourceProvenance {
  const range = byteRange(fullSource, text, searchFrom);
  if (range.start < 0) throw new RangeError("chunk is not present in source at or after searchFrom");
  return {
    file, byteStart: range.start, byteEnd: range.end, contentHash: contentHash(text), strategy,
    ...(heading && { heading: heading.text, headingLevel: heading.level }),
  };
}
