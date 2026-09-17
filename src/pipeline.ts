import { randomUUID } from "node:crypto";
import type { Chunk, ChunkValidation, PipelineResult, PipelineStats, Strategy } from "./types.js";
import { splitWithOffsets } from "./chunk.js";
import { buildCharToByteMap, contentHash } from "./provenance.js";
import { validate } from "./validate.js";
import { assess } from "./assess.js";

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

export function run(source: string, options: PipelineOptions): PipelineResult {
  const start = performance.now();

  // Split with character-offset tracking — no Buffer.indexOf needed.
  const spans = splitWithOffsets(source, options.strategy, options.maxTokens);

  // Build char→byte mapping once for the entire source (O(n) build, O(1) lookup).
  const byteMap = buildCharToByteMap(source);

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
    const byteStart = byteMap[charStart];
    const byteEnd = byteMap[charStart + text.length];
    const hash = contentHash(text);

    // Hash is trivially verified — we just computed it from the same text.
    const assessment = assess(text, true);

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
      validation: doValidate ? validate(text) : CLEAN_VALIDATION,
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
