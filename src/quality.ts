import type { AssessmentReason, ChunkAssessment, ChunkValidation } from "./types.js";

/** Shared heuristic for the public helpers and pipeline; not a semantic proof. */
export function validateAndAssess(text: string, hashVerified: boolean): {
  validation: ChunkValidation; assessment: ChunkAssessment;
} {
  const trimmed = text.trim();
  const heading = /^#{1,6}(?:[ \t]+[^\r\n]*)?$/.test(trimmed);
  const terminal = /[.!?。！？]["'”’»）)\]}]*$/u.test(trimmed);
  const boundaryClean = Boolean(trimmed) && (heading || terminal || /[:;,，；：]$/u.test(trimmed));
  const stack: string[] = [];
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  let balanced = true;
  for (const char of trimmed) {
    if (char === "(" || char === "[" || char === "{") stack.push(char);
    else if (char in pairs && stack.pop() !== pairs[char]) balanced = false;
  }
  balanced = balanced && stack.length === 0;
  const complete = Boolean(trimmed) && balanced && (heading || terminal);
  const warnings: string[] = [];
  const reasons: AssessmentReason[] = [];
  let boundaryScore = 1;
  if (!boundaryClean) {
    warnings.push("may end mid-sentence");
    reasons.push("mid_sentence_boundary");
    boundaryScore -= 0.3;
  }
  if (!balanced) {
    warnings.push("unbalanced or mismatched brackets");
    reasons.push("unbalanced_brackets");
    boundaryScore -= 0.25;
  }
  if (!trimmed) {
    boundaryScore = 0;
    reasons.push("empty_chunk");
  }
  let completenessScore = trimmed ? 1 : 0;
  if (trimmed && trimmed.length < 20) completenessScore -= 0.2;
  if (/^[a-z]/.test(trimmed)) completenessScore -= 0.15;
  if (!complete) completenessScore = Math.min(completenessScore, 0.5);
  const score = boundaryScore * 0.5 + completenessScore * 0.3 + (hashVerified ? 0.2 : 0);
  if (!hashVerified) reasons.push("hash_mismatch");
  if (reasons.length === 0) reasons.push("clean");
  const verdict = !hashVerified || !trimmed ? "reject" : !complete || !boundaryClean ? "flag" : score >= 0.8 ? "pass" : "flag";
  return {
    validation: { status: "checked", boundaryClean, complete, warnings },
    assessment: { verdict, confidence: { score, boundaryScore, completenessScore, hashVerified }, reasons },
  };
}
