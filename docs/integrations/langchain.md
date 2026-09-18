# Add byte-verifiable provenance to a LangChain pipeline

LangChain and stela can occupy different parts of the same RAG pipeline. LangChain supplies loaders, configurable splitters, retrievers, and vector-store integrations. stela supplies exact UTF-8 byte ranges and a hash that is checked before each chunk is emitted.

This guide is based on the checked-in [comparison experiment](../experiments/langchain-comparison/results.md), run on 2026-09-17 with `langchain-text-splitters` 1.1.2 and `@watthem/stela` 0.1.1.

## The practical difference

LangChain's `add_start_index=True` records a Python string index. stela records a byte range into the UTF-8 source artifact.

Those numbers happen to match for ASCII. They diverge after multi-byte characters. In the experiment's 578-byte French document, treating LangChain's character indices as byte indices produced this drift:

```text
chunk 0: +0 bytes
chunk 1: +13 bytes
chunk 2: +24 bytes
```

The LangChain indices were valid character positions. The mistake was using them as file offsets. stela's `[byteStart, byteEnd)` ranges addressed the file bytes directly and passed a SHA-256 check.

Repeated content shows a second difference. Three identical paragraphs received the same content hash but distinct byte ranges:

```text
[589, 816)    4d41fc90...
[818, 1045)   4d41fc90...
[3105, 3332)  4d41fc90...
```

That is the useful shape for provenance: content identity and source location remain separate.

## Run the comparison

From the repository root:

```bash
cd docs/experiments/langchain-comparison
python3 -m venv .venv
.venv/bin/pip install langchain-text-splitters==1.1.2

.venv/bin/python langchain_chunk.py test-document.txt
npx @watthem/stela test-document.txt --strategy paragraph --json > stela-output.json
npx @watthem/stela test-unicode.txt --strategy paragraph --json > stela-unicode-output.json
```

The directory already contains the input documents and captured outputs. The Python script reports whether each `start_index` recovers the chunk when used as a Python string index. To test file provenance, convert character positions to byte positions first or use stela's byte ranges.

## Put stela chunks into LangChain documents

Chunk with stela first, then adapt the verified records to LangChain's `Document` shape:

```ts
import { readFileSync } from "node:fs";
import { run } from "@watthem/stela";
import { Document } from "@langchain/core/documents";

const file = "knowledge-base/handbook.md";
const result = run(readFileSync(file), {
  file,
  strategy: "paragraph",
});

const documents = result.chunks.map((chunk) => new Document({
  pageContent: chunk.text,
  metadata: {
    source: chunk.source.file,
    byteStart: chunk.source.byteStart,
    byteEnd: chunk.source.byteEnd,
    contentHash: chunk.source.contentHash,
    hashVerified: chunk.assessment.confidence.hashVerified,
    qualityVerdict: chunk.assessment.verdict,
  },
}));
```

Pass `documents` to the LangChain vector-store integration you already use. Keep the original source artifact, or an immutable version of it, alongside the records.

## Verify after retrieval

Before showing a citation, read the same source revision and check the returned metadata:

```ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

function verifyRetrieved(document: Document): boolean {
  const { source, byteStart, byteEnd, contentHash } = document.metadata;
  const sourceBytes = readFileSync(source);
  const slice = sourceBytes.subarray(byteStart, byteEnd);
  const hash = createHash("sha256").update(slice).digest("hex");

  return (
    slice.equals(Buffer.from(document.pageContent, "utf8")) &&
    hash === contentHash
  );
}
```

A `false` result means the retrieved record does not match that source revision at the recorded range. Re-chunk and re-index the changed document rather than silently using the stale record.

## Limits

- LangChain's character offsets are not inherently wrong. They are appropriate for slicing the same Python string.
- The comparison's duplicate paragraphs did not make `RecursiveCharacterTextSplitter` fail; all 15 offsets were correct. Failures need particular overlap or splitter conditions, and token-splitter failures are separately documented in [LangChain issue #29884](https://github.com/langchain-ai/langchain/issues/29884).
- stela accepts UTF-8 text only. Use a loader or extractor first for PDF, DOCX, HTML, and other formats.
- stela's `word` strategy counts whitespace-delimited words, not model tokens. Keep LangChain's token-aware splitters when a hard model budget matters, but do not assume their indices are stela byte ranges.
- The experiment measures provenance behavior, not retrieval quality or end-to-end answer accuracy.

