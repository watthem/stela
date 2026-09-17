import type { Strategy } from "./types.js";

export function splitByHeading(text: string): string[] {
  const sections = text.split(/^(#{1,6}\s+.+)$/m);
  const chunks: string[] = [];
  let current = "";

  for (const section of sections) {
    if (/^#{1,6}\s+/.test(section)) {
      if (current.trim()) chunks.push(current.trim());
      // The newline after the heading is still in the next section, so do not
      // add one here — the chunk must remain a verbatim substring of the source.
      current = section;
    } else {
      current += section;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter((c) => c.length > 0);
}

export function splitByParagraph(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export function splitBySentence(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function splitByToken(text: string, maxTokens = 256): string[] {
  // Slice by word offsets rather than re-joining with " " so that every chunk
  // is a verbatim substring of the source and its byte range can be recovered.
  const words = [...text.matchAll(/\S+/g)];
  const chunks: string[] = [];

  for (let i = 0; i < words.length; i += maxTokens) {
    const first = words[i];
    const last = words[Math.min(i + maxTokens, words.length) - 1];
    chunks.push(text.slice(first.index, last.index + last[0].length));
  }
  return chunks;
}

export function split(text: string, strategy: Strategy, maxTokens?: number): string[] {
  switch (strategy) {
    case "heading":
      return splitByHeading(text);
    case "paragraph":
      return splitByParagraph(text);
    case "sentence":
      return splitBySentence(text);
    case "token":
      return splitByToken(text, maxTokens);
  }
}
