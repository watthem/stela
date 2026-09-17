import type { ChunkValidation } from "./types.js";

export function validate(text: string): ChunkValidation {
  const warnings: string[] = [];
  let boundaryClean = true;
  let complete = true;

  if (/^\S/.test(text) && /\w$/.test(text.charAt(0))) {
    const prevChar = text.charAt(0);
    if (/\w/.test(prevChar)) {
      // Could be mid-word at start — check if first char follows a word char
    }
  }

  if (/\S$/.test(text) && !/[.!?:;,\s]$/.test(text)) {
    warnings.push("may end mid-word");
    boundaryClean = false;
  }

  const opens = (text.match(/[(\[{]/g) || []).length;
  const closes = (text.match(/[)\]}]/g) || []).length;
  if (opens !== closes) {
    warnings.push("unbalanced brackets");
    complete = false;
  }

  return { boundaryClean, complete, warnings };
}
