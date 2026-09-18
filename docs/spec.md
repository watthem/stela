# stela spec

Living reference for what stela is, how it works, and what it guarantees. Update this when the implementation changes.

## Identity

- **Name:** stela
- **Package:** @watthem/stela
- **One-liner:** Git blame for AI answers — document preprocessing with provenance tracking
- **License:** MIT
- **Runtime:** Node.js >= 22
- **Language:** TypeScript, zero runtime dependencies
- **Current version:** 0.2.1

## What it does

stela chunks UTF-8 text and attaches a verified source byte range and SHA-256 hash to every chunk. Given a chunk, you can slice the original file at those byte offsets and get the chunk content back, byte for byte. If it doesn't verify, it throws.

## The provenance contract

This is the core guarantee. Everything else is secondary.

- `source.byteStart` / `source.byteEnd` is a zero-based, half-open byte range `[start, end)` into the original UTF-8 source.
- Line endings and Unicode are not normalized. Chunks are verbatim slices.
- Before emitting each chunk, the pipeline verifies: bounds, ordering, equality with the source-byte slice, and SHA-256.
- A failed check throws. `hashVerified: true` means the chunk matched.
- This does not prove a generated claim is supported, authenticate the source's author, or detect future edits.

## Pipeline stages

1. **Validate input** — accepts string or Buffer, rejects malformed UTF-8, binary, PDF, ZIP
2. **Decode source** — produces the text and the original UTF-8 byte buffer
3. **Split with offsets** — splits by strategy, each chunk carries a character offset, converted to byte range
4. **Verify provenance** — computes bytes, SHA-256, slices original, compares. Throws on mismatch.
5. **Assess quality** — heuristic checks: `boundaryClean`, `complete`, warnings, verdict (`pass`/`flag`/`reject`/`skipped`)
6. **Return PipelineResult** — chunks array + stats

## Strategies

| Strategy | How it splits | Notes |
|---|---|---|
| `paragraph` | Blank-line boundaries | LF, CRLF, CR, whitespace-only lines |
| `heading` | ATX `#` headings and legal section headings outside fenced code blocks | Matches ARTICLE, Section, Exhibit, Schedule, RECITALS, PREAMBLE, WHEREAS. Not a full Markdown parser. No Setext support. |
| `sentence` | `Intl.Segmenter` (English) | Retains common abbreviations. CJK punctuation handled. Boundaries vary by Node/ICU version. |
| `word` | Whitespace-delimited word count | Not model tokens. `--max-words` controls chunk size. |

`token` is a deprecated alias for `word`. `--max-tokens`, `maxTokens`, `splitByToken` warn and redirect.

## Data model

```
Chunk {
  id: string
  index: number
  text: string
  source: SourceProvenance {
    file: string
    byteStart: number
    byteEnd: number
    contentHash: string (SHA-256)
    strategy: Strategy
    heading?: string
    headingLevel?: number
  }
  validation: ChunkValidation {
    status: "checked" | "skipped"
    boundaryClean: boolean | null
    complete: boolean | null
    warnings: string[]
  }
  assessment: ChunkAssessment {
    verdict: "pass" | "flag" | "reject" | "skipped"
    confidence: ProvenanceConfidence
    reasons: AssessmentReason[]
  }
}

PipelineResult { chunks: Chunk[]; stats: PipelineStats }
```

## CLI

```
stela <file> [options]
  --strategy <heading|paragraph|sentence|word>
  --max-words <n>
  --no-validate
  --json
  --stats
  --help, -h
```

## Library

```javascript
import { run } from '@watthem/stela';
const result = run(text, { strategy: 'paragraph', file: 'source.txt' });
```

`splitByHeading`, `splitByParagraph`, `splitBySentence`, `splitByWord` return text-only arrays without provenance verification. Use `run` for verified chunks.

## Source files

| File | Role |
|---|---|
| `src/pipeline.ts` | Orchestration, `run()` entrypoint |
| `src/chunk.ts` | Splitting logic by strategy |
| `src/provenance.ts` | UTF-8 validation, byte mapping, SHA-256 |
| `src/quality.ts` | Heuristic validation and assessment |
| `src/types.ts` | Data model |
| `src/cli.ts` | CLI entrypoint |
| `src/validate.ts` | Input validation |
| `src/assess.ts` | Assessment helpers |
| `src/index.ts` | Public exports |

## What stela is not

- Not a semantic parser. It splits deterministically by structure, not meaning.
- Not an LLM tokenizer. Word counts are whitespace-delimited, not BPE/SentencePiece.
- Not a PDF/DOCX extractor. Extract text first, then chunk.
- Not an authentication or authorship system. It verifies byte integrity, not who wrote the document.

## Design constraints

- Zero runtime dependencies
- Deterministic: same input, same output (pin Node/ICU version for sentence strategy)
- Throws on verification failure rather than emitting bad provenance
- Chunks are verbatim slices, never normalized or cleaned
