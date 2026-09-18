# How stela works

Retrieval-augmented generation (RAG) pulls chunks of text from documents to give a language model context for an answer. stela handles the step before retrieval: it splits UTF-8 text while retaining enough information to trace each chunk to the exact bytes that produced it.

Run it on a text file:

```bash
npx @watthem/stela README.md
```

The default output is one JSON object per line. Each object contains the chunk text, a source byte range, a SHA-256 hash, and a quality assessment.

## The pipeline

### 1. Read the original bytes

The CLI reads the file as a `Buffer`. The library accepts either a `Buffer` or a JavaScript string.

- With a `Buffer`, offsets refer to the supplied bytes.
- With a string, offsets refer to its UTF-8 encoding. The `file` option is only a label; `run()` does not open it.

stela rejects malformed UTF-8, NUL-containing binary input, PDF and ZIP containers, and ill-formed JavaScript strings. It does not extract text from PDF or DOCX files.

### 2. Split and retain positions

Choose one of four strategies:

| Strategy | Boundary |
|---|---|
| `paragraph` | Blank lines, including CRLF and whitespace-only blank lines |
| `heading` | ATX Markdown headings and common legal headings outside fenced code blocks |
| `sentence` | The Node runtime's English `Intl.Segmenter` |
| `word` | A fixed number of whitespace-delimited words |

The splitter records where each chunk begins while it walks the source. It does not split first and search the document afterward. That distinction matters when the same text occurs more than once or when characters occupy more than one UTF-8 byte.

### 3. Convert character positions to byte ranges

JavaScript string positions count UTF-16 code units. Files contain bytes. For non-ASCII text, stela builds a map from valid UTF-16 boundaries to UTF-8 byte offsets, then returns a zero-based, half-open range:

```text
[source.byteStart, source.byteEnd)
```

The range excludes surrounding separators that the selected strategy omitted. Concatenating chunks is therefore not guaranteed to reconstruct the whole file.

### 4. Hash and verify every chunk

Before a chunk is emitted, stela:

1. checks that its range is ordered, in bounds, and does not overlap the prior range;
2. slices the original source bytes at that range;
3. compares the slice with the chunk's UTF-8 bytes; and
4. compares the slice's SHA-256 hash with `source.contentHash`.

If any check fails, the pipeline throws. It never emits a chunk with known-bad provenance.

### 5. Assess boundary quality

Unless you pass `--no-validate` or `validate: false`, stela applies lightweight checks for sentence endings and balanced brackets. These checks produce `pass`, `flag`, or `reject`. They are heuristics, not a factuality or semantic-completeness score.

Disabling validation sets the verdict and scores to `skipped` and `null`. Byte and hash verification still run.

### 6. Return chunks and stats

The CLI emits NDJSON by default or a JSON array with `--json`. The library returns:

```ts
{ chunks: Chunk[], stats: PipelineStats }
```

See [The provenance contract](provenance-contract.md) for the precise guarantee, [CLI reference](cli-reference.md) for every flag, and [Library API](library-api.md) for the exported types.

