import { randomUUID } from "node:crypto";
import type { Chunk, ChunkAssessment, ChunkValidation, PipelineResult, Strategy } from "./types.js";
import { splitWithOffsets } from "./chunk.js";
import { buildCharToByteMap, contentHash, decodeSource } from "./provenance.js";
import { validateAndAssess } from "./quality.js";

export interface PipelineOptions {
  strategy: Strategy;
  maxWords?: number;
  /** @deprecated Word-count alias; does not limit model tokens. */
  maxTokens?: number;
  /** Source label. For string input, ranges refer to its UTF-8 encoding, not a disk read. */
  file: string;
  validate?: boolean;
}

export function run(input: string | Buffer, options: PipelineOptions): PipelineResult {
  const start = performance.now();
  if (!options || typeof options.file !== "string" || !options.file.trim()) throw new TypeError("file must be a nonempty source label");
  if (options.validate !== undefined && typeof options.validate !== "boolean") throw new TypeError("validate must be a boolean");
  if (options.maxWords !== undefined && options.maxTokens !== undefined) throw new TypeError("provide maxWords or maxTokens, not both");
  const { text: source, bytes } = decodeSource(input);
  const spans = splitWithOffsets(source, options.strategy, options.maxWords ?? options.maxTokens);
  const isAscii = bytes.length === source.length;
  const byteMap = isAscii ? null : buildCharToByteMap(source);
  const chunks: Chunk[] = [];
  let totalScore = 0;
  let passed = 0;
  let flagged = 0;
  let rejected = 0;
  let skipped = 0;
  let previousEnd = 0;
  for (const [index, { text, charStart }] of spans.entries()) {
    const byteStart = isAscii ? charStart : byteMap![charStart];
    const byteEnd = isAscii ? charStart + text.length : byteMap![charStart + text.length];
    const chunkBytes = Buffer.from(text, "utf8");
    const hash = contentHash(chunkBytes);
    const rangeValid = Number.isSafeInteger(byteStart) && Number.isSafeInteger(byteEnd) &&
      byteStart >= previousEnd && byteStart < byteEnd && byteEnd <= bytes.length;
    const slice = bytes.subarray(byteStart, byteEnd);
    const hashVerified = rangeValid && slice.equals(chunkBytes) && contentHash(slice) === hash;
    // Never emit a provenance record whose source bytes cannot be verified.
    if (!hashVerified) throw new Error(`source provenance verification failed for chunk ${index}`);
    previousEnd = byteEnd;
    let validation: ChunkValidation;
    let assessment: ChunkAssessment;
    if (options.validate === false) {
      validation = { status: "skipped", boundaryClean: null, complete: null, warnings: [] };
      assessment = {
        verdict: "skipped",
        confidence: { score: null, boundaryScore: null, completenessScore: null, hashVerified },
        reasons: ["validation_skipped"],
      };
    } else ({ validation, assessment } = validateAndAssess(text, hashVerified));
    totalScore += assessment.confidence.score ?? 0;
    switch (assessment.verdict) {
      case "pass": passed++; break;
      case "flag": flagged++; break;
      case "reject": rejected++; break;
      case "skipped": skipped++; break;
    }
    chunks.push({
      id: randomUUID(), index, text,
      source: { file: options.file, byteStart, byteEnd, contentHash: hash, strategy: options.strategy },
      validation, assessment,
    });
  }
  const assessed = chunks.length - skipped;
  return { chunks, stats: {
    totalChunks: chunks.length, passed, flagged, rejected, skipped,
    meanConfidence: assessed ? totalScore / assessed : null,
    processingMs: performance.now() - start,
  } };
}
