import { randomUUID } from "node:crypto";
import type { Chunk, PipelineResult, PipelineStats, Strategy } from "./types.js";
import { split } from "./chunk.js";
import { createProvenance, contentHash } from "./provenance.js";
import { validate } from "./validate.js";
import { assessAll } from "./assess.js";

export interface PipelineOptions {
  strategy: Strategy;
  maxTokens?: number;
  file: string;
  validate?: boolean;
}

export function run(source: string, options: PipelineOptions): PipelineResult {
  const start = performance.now();
  const texts = split(source, options.strategy, options.maxTokens);

  // Tier 1: Create chunks with provenance
  let searchFrom = 0;
  const rawChunks = texts.map((text, index) => {
    const provenance = createProvenance(
      options.file,
      text,
      source,
      options.strategy,
      searchFrom,
    );
    searchFrom = Math.max(searchFrom, provenance.byteEnd);

    return {
      id: randomUUID(),
      index,
      text,
      source: provenance,
      validation:
        options.validate !== false
          ? validate(text)
          : { boundaryClean: true, complete: true, warnings: [] },
    };
  });

  // Tier 2: Structured assessment — parallel scoring, no generation
  const assessments = assessAll(
    rawChunks.map((c) => ({
      text: c.text,
      hashVerified: contentHash(c.text) === c.source.contentHash,
    })),
  );

  const chunks: Chunk[] = rawChunks.map((c, i) => ({
    ...c,
    assessment: assessments[i],
  }));

  const stats: PipelineStats = {
    totalChunks: chunks.length,
    passed: chunks.filter((c) => c.assessment.verdict === "pass").length,
    flagged: chunks.filter((c) => c.assessment.verdict === "flag").length,
    rejected: chunks.filter((c) => c.assessment.verdict === "reject").length,
    meanConfidence:
      chunks.reduce((sum, c) => sum + c.assessment.confidence.score, 0) /
      (chunks.length || 1),
    processingMs: performance.now() - start,
  };

  return { chunks, stats };
}
