# stela

Git blame for AI answers. Document preprocessing with provenance tracking.

stela chunks documents and tracks exactly which bytes produced each chunk — content hashes, byte ranges, and a structured quality assessment. When a RAG answer goes wrong, trace it back to the source paragraph.

## Quick start

```bash
npx @watthem/stela README.md
```

```bash
npx @watthem/stela --strategy heading --json report.pdf
```

## What it does

**Tier 1 — Chunking + Provenance**
Split by heading, paragraph, sentence, or token. Every chunk gets a SHA-256 content hash and byte-range mapping back to the source file.

**Tier 2 — Quality Assessment**
Each chunk is scored on boundary quality and completeness. Verdicts: `pass`, `flag`, `reject` — with calibrated confidence scores and structured reasons (no LLM, no free-form text).

## CLI

```
stela <file> [options]

Options:
  --strategy <type>   heading | paragraph | sentence | token (default: paragraph)
  --max-tokens <n>    Maximum tokens per chunk (token strategy only)
  --no-validate       Skip validation
  --json              JSON output
  --stats             Show performance stats
```

## Library

```typescript
import { run } from "@watthem/stela";

const result = await run(documentText, {
  strategy: "paragraph",
});

for (const item of result.results) {
  console.log(item.chunk.content);
  console.log(item.provenance.contentHash);
  console.log(item.provenance.byteRange);
  console.log(item.assessment.verdict);
}
```

## Performance

| Dataset | Chunks | MB/s | Provenance failures |
|---------|--------|------|---------------------|
| Wikipedia 100K articles | 1.2M | 46.5 | 0 |
| SEC 10-K filings | 521K | 49.3 | 0 |

MB/s is pipeline processing time only, measured via `--stats`. Wall-clock throughput via `npx` will be lower due to Node.js startup overhead. Run `npm install -g @watthem/stela` to eliminate startup cost for repeated use.

Requires Node.js 22+.

## License

Proprietary. Free to use. Source not included.
