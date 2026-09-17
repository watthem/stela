/** token is a deprecated alias for word; neither measures model tokens. */
export type Strategy = "heading" | "paragraph" | "sentence" | "word" | "token";

export interface SourceProvenance {
  file: string;
  byteStart: number;
  byteEnd: number;
  contentHash: string;
  strategy: Strategy;
  heading?: string;
  headingLevel?: number;
}

export interface ChunkValidation {
  status: "checked" | "skipped";
  boundaryClean: boolean | null;
  complete: boolean | null;
  warnings: string[];
}

/** Heuristic quality scores, not calibrated probabilities of correctness. */
export interface ProvenanceConfidence {
  /** Null when quality assessment was skipped. */
  score: number | null;
  boundaryScore: number | null;
  completenessScore: number | null;
  /** Whether source-slice bytes and their SHA-256 match this chunk. */
  hashVerified: boolean;
}
export type ChunkVerdict = "pass" | "flag" | "reject" | "skipped";
export interface ChunkAssessment {
  verdict: ChunkVerdict;
  confidence: ProvenanceConfidence;
  reasons: AssessmentReason[];
}
export type AssessmentReason =
  | "mid_word_boundary" | "mid_sentence_boundary" | "unbalanced_brackets"
  | "incomplete_heading" | "hash_mismatch" | "empty_chunk" | "overlapping_range"
  | "validation_skipped" | "clean";
export interface Chunk {
  id: string;
  index: number;
  text: string;
  source: SourceProvenance;
  validation: ChunkValidation;
  assessment: ChunkAssessment;
}
export interface PipelineResult { chunks: Chunk[]; stats: PipelineStats; }
export interface PipelineStats {
  totalChunks: number;
  passed: number;
  flagged: number;
  rejected: number;
  skipped: number;
  /** Mean over assessed chunks only; null if there are none. */
  meanConfidence: number | null;
  processingMs: number;
}
