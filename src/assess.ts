import type { ChunkAssessment } from "./types.js";
import { validateAndAssess } from "./quality.js";

/** Heuristic quality assessment. The caller supplies the hash verification result. */
export function assess(text: string, hashVerified: boolean): ChunkAssessment {
  return validateAndAssess(text, hashVerified).assessment;
}
export function assessAll(chunks: Array<{ text: string; hashVerified: boolean }>): ChunkAssessment[] {
  return chunks.map(c => assess(c.text, c.hashVerified));
}
