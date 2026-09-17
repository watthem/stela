import type {
  ChunkAssessment,
  ChunkVerdict,
  AssessmentReason,
  ProvenanceConfidence,
} from "./types.js";

/** Score a single assessment dimension — returns calibrated 0-1. */
function scoreBoundary(text: string): { score: number; reasons: AssessmentReason[] } {
  const reasons: AssessmentReason[] = [];
  let score = 1.0;

  const isHeading = /^\s*#/.test(text);

  if (!isHeading && /\S$/.test(text) && !/[.!?:;,\s]$/.test(text)) {
    score -= 0.3;
    reasons.push("mid_word_boundary");
  }

  if (!isHeading && text.length > 0 && !/[.!?]/.test(text)) {
    score -= 0.15;
    reasons.push("mid_sentence_boundary");
  }

  const opens = (text.match(/[(\[{]/g) || []).length;
  const closes = (text.match(/[)\]}]/g) || []).length;
  if (opens !== closes) {
    score -= 0.25;
    reasons.push("unbalanced_brackets");
  }

  if (text.trim().length === 0) {
    score = 0;
    reasons.push("empty_chunk");
  }

  if (reasons.length === 0) reasons.push("clean");
  return { score: Math.max(0, score), reasons };
}

function scoreCompleteness(text: string): number {
  if (text.trim().length === 0) return 0;
  let score = 1.0;
  // Penalize very short chunks (likely fragments)
  if (text.trim().length < 20) score -= 0.2;
  // Penalize chunks that start with lowercase (likely mid-sentence split)
  if (/^[a-z]/.test(text.trim())) score -= 0.15;
  return Math.max(0, score);
}

/** Parallel assessment of all quality dimensions — no sequential generation needed. */
export function assess(text: string, hashVerified: boolean): ChunkAssessment {
  const boundary = scoreBoundary(text);
  const completenessScore = scoreCompleteness(text);

  const confidence: ProvenanceConfidence = {
    score: boundary.score * 0.5 + completenessScore * 0.3 + (hashVerified ? 0.2 : 0),
    boundaryScore: boundary.score,
    completenessScore,
    hashVerified,
  };

  let verdict: ChunkVerdict;
  if (confidence.score >= 0.8) verdict = "pass";
  else if (confidence.score >= 0.5) verdict = "flag";
  else verdict = "reject";

  const reasons: AssessmentReason[] = hashVerified
    ? boundary.reasons
    : [...boundary.reasons.filter((r) => r !== "clean"), "hash_mismatch"];

  return { verdict, confidence, reasons };
}

/** Assess all chunks in parallel (structured prediction, not sequential). */
export function assessAll(
  chunks: Array<{ text: string; hashVerified: boolean }>,
): ChunkAssessment[] {
  return chunks.map((c) => assess(c.text, c.hashVerified));
}
