export type Strategy = "heading" | "paragraph" | "sentence" | "token";

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
  boundaryClean: boolean;
  complete: boolean;
  warnings: string[];
}

/** Calibrated confidence scoring inspired by RLCD. */
export interface ProvenanceConfidence {
  /** 0-1, calibrated: 0.9 means right 90% of the time. */
  score: number;
  boundaryScore: number;
  completenessScore: number;
  hashVerified: boolean;
}

/** Structured verdict — no free-form text, just predefined outcomes. */
export type ChunkVerdict = "pass" | "flag" | "reject";

export interface ChunkAssessment {
  verdict: ChunkVerdict;
  confidence: ProvenanceConfidence;
  reasons: AssessmentReason[];
}

export type AssessmentReason =
  | "mid_word_boundary"
  | "mid_sentence_boundary"
  | "unbalanced_brackets"
  | "incomplete_heading"
  | "hash_mismatch"
  | "empty_chunk"
  | "overlapping_range"
  | "clean";

export interface Chunk {
  id: string;
  index: number;
  text: string;
  source: SourceProvenance;
  validation: ChunkValidation;
  /** Structured verdict with calibrated confidence. */
  assessment: ChunkAssessment;
}

export interface PipelineResult {
  chunks: Chunk[];
  stats: PipelineStats;
}

export interface PipelineStats {
  totalChunks: number;
  passed: number;
  flagged: number;
  rejected: number;
  meanConfidence: number;
  processingMs: number;
}
