import { randomUUID } from "node:crypto";
import type {
  AssessmentReason,
  Chunk,
  ChunkAssessment,
  ChunkValidation,
  ChunkVerdict,
  PipelineResult,
  PipelineStats,
  Strategy,
} from "./types.js";
import { splitWithOffsets } from "./chunk.js";
import { buildCharToByteMap, contentHash } from "./provenance.js";

export interface PipelineOptions {
  strategy: Strategy;
  maxTokens?: number;
  file: string;
  validate?: boolean;
}

const CLEAN_VALIDATION: ChunkValidation = {
  boundaryClean: true,
  complete: true,
  warnings: [],
};

const CLEAN_ASSESSMENT: ChunkAssessment = {
  verdict: "pass",
  confidence: { score: 1, boundaryScore: 1, completenessScore: 1, hashVerified: true },
  reasons: ["clean"],
};

/**
 * Combined validate + assess in a single text scan.
 *
 * The original validate() and assess() duplicate work: both check
 * end-of-word boundaries and count brackets via text.match() (which
 * allocates an array of every match).  This function replaces both with
 * one charCode loop and no regex-allocated arrays.
 */
function validateAndAssess(text: string): {
  validation: ChunkValidation;
  assessment: ChunkAssessment;
} {
  const textLen = text.length;
  const warnings: string[] = [];
  let boundaryClean = true;
  let complete = true;
  const reasons: AssessmentReason[] = [];
  let boundaryScore = 1.0;

  // Single scan for brackets, sentence-ending punctuation, trim bounds, and heading detection.
  let hasSentenceEnd = false;
  let opens = 0;
  let closes = 0;
  let firstNonSpace = -1;
  let lastNonSpace = -1;

  for (let i = 0; i < textLen; i++) {
    const c = text.charCodeAt(i);
    if (c === 46 || c === 33 || c === 63) hasSentenceEnd = true; // . ! ?
    if (c === 40 || c === 91 || c === 123) opens++; // ( [ {
    else if (c === 41 || c === 93 || c === 125) closes++; // ) ] }
    if (c > 32) {
      if (firstNonSpace === -1) firstNonSpace = i;
      lastNonSpace = i;
    }
  }

  const trimmedLen =
    firstNonSpace === -1 ? 0 : lastNonSpace - firstNonSpace + 1;

  // Headings (lines starting with #) are structural markers, not sentences.
  // Don't penalize them for lacking sentence-ending punctuation or trailing punct.
  const isHeading = firstNonSpace !== -1 && text.charCodeAt(firstNonSpace) === 35; // #

  // End-of-word check — skip for headings (they end with complete words, not truncated text)
  if (textLen > 0 && !isHeading) {
    const lastCode = text.charCodeAt(textLen - 1);
    // .=46 !=33 ?=63 :=58 ;=59 ,=44
    const isPunct =
      lastCode === 46 ||
      lastCode === 33 ||
      lastCode === 63 ||
      lastCode === 58 ||
      lastCode === 59 ||
      lastCode === 44;
    if (lastCode > 32 && !isPunct) {
      warnings.push("may end mid-word");
      boundaryClean = false;
      boundaryScore -= 0.3;
      reasons.push("mid_word_boundary");
    }
  }

  if (textLen > 0 && !hasSentenceEnd && !isHeading) {
    boundaryScore -= 0.15;
    reasons.push("mid_sentence_boundary");
  }

  if (opens !== closes) {
    warnings.push("unbalanced brackets");
    complete = false;
    boundaryScore -= 0.25;
    reasons.push("unbalanced_brackets");
  }

  if (trimmedLen === 0) {
    boundaryScore = 0;
    reasons.push("empty_chunk");
  }

  if (reasons.length === 0) reasons.push("clean");
  boundaryScore = Math.max(0, boundaryScore);

  // Completeness score
  let completenessScore = 1.0;
  if (trimmedLen === 0) {
    completenessScore = 0;
  } else {
    if (trimmedLen < 20) completenessScore -= 0.2;
    const firstCharCode = text.charCodeAt(firstNonSpace);
    if (firstCharCode >= 97 && firstCharCode <= 122) completenessScore -= 0.15; // a-z
    completenessScore = Math.max(0, completenessScore);
  }

  // hashVerified is always true in pipeline (we just computed the hash)
  const score = boundaryScore * 0.5 + completenessScore * 0.3 + 0.2;

  let verdict: ChunkVerdict;
  if (score >= 0.8) verdict = "pass";
  else if (score >= 0.5) verdict = "flag";
  else verdict = "reject";

  return {
    validation: { boundaryClean, complete, warnings },
    assessment: {
      verdict,
      confidence: {
        score,
        boundaryScore,
        completenessScore,
        hashVerified: true,
      },
      reasons,
    },
  };
}

export function run(source: string, options: PipelineOptions): PipelineResult {
  const start = performance.now();

  // Split with character-offset tracking — no Buffer.indexOf needed.
  const spans = splitWithOffsets(source, options.strategy, options.maxTokens);

  // ASCII fast path: when every character is one byte, char offsets ARE byte
  // offsets and we can skip the Uint32Array mapping entirely.
  const isAscii = Buffer.byteLength(source) === source.length;
  const byteMap = isAscii ? null : buildCharToByteMap(source);

  const len = spans.length;
  const chunks: Chunk[] = new Array(len);
  const doValidate = options.validate !== false;
  const file = options.file;
  const strategy = options.strategy;

  // Single-pass: build chunks and accumulate stats together.
  let totalScore = 0;
  let passed = 0;
  let flagged = 0;
  let rejected = 0;

  for (let i = 0; i < len; i++) {
    const { text, charStart } = spans[i];
    const byteStart = isAscii ? charStart : byteMap![charStart];
    const byteEnd = isAscii
      ? charStart + text.length
      : byteMap![charStart + text.length];
    const hash = contentHash(text);

    let validation: ChunkValidation;
    let assessment: ChunkAssessment;

    if (doValidate) {
      const result = validateAndAssess(text);
      validation = result.validation;
      assessment = result.assessment;
    } else {
      validation = CLEAN_VALIDATION;
      assessment = CLEAN_ASSESSMENT;
    }

    totalScore += assessment.confidence.score;
    const v = assessment.verdict;
    if (v === "pass") passed++;
    else if (v === "flag") flagged++;
    else rejected++;

    chunks[i] = {
      id: randomUUID(),
      index: i,
      text,
      source: {
        file,
        byteStart,
        byteEnd,
        contentHash: hash,
        strategy,
      },
      validation,
      assessment,
    };
  }

  return {
    chunks,
    stats: {
      totalChunks: len,
      passed,
      flagged,
      rejected,
      meanConfidence: totalScore / (len || 1),
      processingMs: performance.now() - start,
    },
  };
}
