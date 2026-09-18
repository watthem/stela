# Library API

Install the package on Node.js 22 or later:

```bash
npm install @watthem/stela
```

## `run()`

`run()` executes splitting, byte-range construction, verification, and optional quality assessment.

```ts
import { readFileSync } from "node:fs";
import { run } from "@watthem/stela";

const path = "source.txt";
const result = run(readFileSync(path), {
  file: path,
  strategy: "paragraph",
});
```

The signature is:

```ts
function run(input: string | Buffer, options: PipelineOptions): PipelineResult;

interface PipelineOptions {
  strategy: "heading" | "paragraph" | "sentence" | "word" | "token";
  file: string;
  maxWords?: number;
  maxTokens?: number; // deprecated word-count alias
  validate?: boolean;
}
```

`file` must be a nonempty source label. `maxWords` is allowed only for the `word` strategy. `validate` defaults to `true`; setting it to `false` skips only the quality checks.

For disk files, pass a `Buffer` as shown above. If you pass a string, byte ranges refer to the string's UTF-8 encoding, and stela does not read the path in `file`.

## `PipelineResult`

```ts
interface PipelineResult {
  chunks: Chunk[];
  stats: PipelineStats;
}

interface PipelineStats {
  totalChunks: number;
  passed: number;
  flagged: number;
  rejected: number;
  skipped: number;
  meanConfidence: number | null;
  processingMs: number;
}
```

`meanConfidence` includes assessed chunks only. It is `null` for empty input or when all chunks were skipped.

## `Chunk`

```ts
interface Chunk {
  id: string;
  index: number;
  text: string;
  source: SourceProvenance;
  validation: ChunkValidation;
  assessment: ChunkAssessment;
}
```

| Field | Meaning |
|---|---|
| `id` | A UUID generated for this run. Do not expect stable IDs across runs. |
| `index` | Zero-based order in the emitted chunk list. |
| `text` | A verbatim UTF-8 slice of the source, decoded to a string. |
| `source` | Location, hash, and strategy metadata. |
| `validation` | Boundary/completeness heuristic result or `skipped`. |
| `assessment` | Quality verdict, confidence components, and reasons. |

### `SourceProvenance`

```ts
interface SourceProvenance {
  file: string;
  byteStart: number;
  byteEnd: number;
  contentHash: string;
  strategy: Strategy;
  heading?: string;
  headingLevel?: number;
}
```

The range is zero-based and half-open. `contentHash` is the lowercase hexadecimal SHA-256 of the source bytes in that range. Heading metadata appears only when the heading strategy recognized a heading.

### `ChunkValidation`

```ts
interface ChunkValidation {
  status: "checked" | "skipped";
  boundaryClean: boolean | null;
  complete: boolean | null;
  warnings: string[];
}
```

`boundaryClean` and `complete` are heuristic signals. They are `null` when validation was skipped.

### `ChunkAssessment`

```ts
interface ChunkAssessment {
  verdict: "pass" | "flag" | "reject" | "skipped";
  confidence: {
    score: number | null;
    boundaryScore: number | null;
    completenessScore: number | null;
    hashVerified: boolean;
  };
  reasons: AssessmentReason[];
}
```

Scores are heuristics, not calibrated probabilities. `hashVerified` is separate from those quality scores and is always checked before a chunk is returned.

`AssessmentReason` can be `mid_word_boundary`, `mid_sentence_boundary`, `unbalanced_brackets`, `incomplete_heading`, `hash_mismatch`, `empty_chunk`, `overlapping_range`, `validation_skipped`, or `clean`.

## Text-only splitters

The package also exports:

```ts
splitByHeading(text: string): string[];
splitByParagraph(text: string): string[];
splitBySentence(text: string): string[];
splitByWord(text: string, maxWords?: number): string[];
```

These helpers return strings only. They do not create or verify provenance. Use `run()` when source traceability matters.

`splitByToken()` and the `token` strategy are deprecated word-count aliases.

## Store provenance with vectors

Keep the source metadata next to the embedding rather than rebuilding it after retrieval:

```ts
const { chunks } = run(readFileSync(path), {
  file: path,
  strategy: "paragraph",
});

const records = await Promise.all(chunks.map(async (chunk) => ({
  id: chunk.id,
  values: await embed(chunk.text),
  metadata: {
    text: chunk.text,
    file: chunk.source.file,
    byteStart: chunk.source.byteStart,
    byteEnd: chunk.source.byteEnd,
    contentHash: chunk.source.contentHash,
  },
})));

await vectorStore.upsert(records);
```

After retrieval, slice the saved source artifact at `byteStart` and `byteEnd`, then recompute SHA-256 as shown in [The provenance contract](provenance-contract.md). This detects whether the retrieved record still matches that source revision.

