# The provenance contract

This page defines what stela's byte ranges and hashes mean. It is the part of the API to rely on when storing chunks, verifying citations, or detecting stale source material.

## The guarantee

For every chunk returned by `run()`:

```text
sourceBytes.subarray(chunk.source.byteStart, chunk.source.byteEnd)
```

equals:

```text
Buffer.from(chunk.text, "utf8")
```

The SHA-256 digest of that same source slice equals `chunk.source.contentHash`, and `chunk.assessment.confidence.hashVerified` is `true`.

Ranges are zero-based and half-open: `byteStart` is included and `byteEnd` is excluded. stela does not normalize line endings, Unicode, or whitespace inside a chunk.

## Independent verification

You do not need stela to verify a stored chunk. You need the exact source artifact and Node's standard crypto library:

```ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const source = readFileSync(record.source.file);
const bytes = source.subarray(record.source.byteStart, record.source.byteEnd);
const hash = createHash("sha256").update(bytes).digest("hex");

if (!bytes.equals(Buffer.from(record.text, "utf8"))) {
  throw new Error("source slice no longer matches the stored chunk");
}

if (hash !== record.source.contentHash) {
  throw new Error("source slice hash no longer matches");
}
```

Store or version the source artifact with the chunks. A byte range alone cannot identify which revision of a changing file it refers to.

## Buffer and string inputs

`run()` accepts `Buffer` or string input.

| Input | What the range addresses |
|---|---|
| `Buffer` | The exact supplied bytes |
| string | `Buffer.from(input, "utf8")` |

For disk files, prefer `readFileSync(path)` so the contract is tied directly to the bytes on disk. With string input, `options.file` is descriptive metadata; stela does not read or compare that path.

## What `hashVerified: true` proves

It proves that, during that call to `run()`:

- the range was valid and ordered;
- the source slice equaled the chunk's UTF-8 bytes; and
- the stored SHA-256 matched that slice.

It does not prove that:

- a generated answer is supported by the chunk;
- the source is true, authentic, or written by a claimed author;
- an external file has not changed since chunking; or
- the quality heuristic correctly judged semantic completeness.

To detect later edits, repeat the independent verification against the source revision you want to trust. A mismatch means the stored chunk and that source revision are no longer the same at the recorded range; it does not explain why they differ.

## Omitted bytes

Split strategies can omit separators around chunks. Paragraph splitting, for example, excludes the blank lines between paragraphs. Each chunk is a verbatim slice, but the ordered chunk list is not necessarily a lossless representation of every byte in the source.

