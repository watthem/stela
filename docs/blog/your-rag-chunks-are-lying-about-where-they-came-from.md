# Your RAG chunks are lying about where they came from

Many chunking libraries give you a `start_index` without defining it as a file-byte offset or verifying it against the source bytes. Treat that field as file provenance and it can point at the wrong text.

[stela](https://www.npmjs.com/package/@watthem/stela) is a TypeScript CLI that tracks byte offsets during the split, then verifies them with the source bytes and a SHA-256 hash.

![Character position is not a file-byte position](../assets/illustrations/coordinate-systems.svg)

## The offset drift problem

LangChain's `RecursiveCharacterTextSplitter` has an `add_start_index` option. It splits the text, then searches for each chunk's position using `text.find()`. The number you get back is a Python character offset.

Character offsets and byte offsets are the same for ASCII. They diverge after accented characters, CJK text, emoji, and other multi-byte UTF-8 characters. LangChain's index is still valid for slicing the decoded Python string. It becomes wrong when a pipeline stores that number and later uses it as an offset into the file bytes.

I tested on a French technical document (546 characters, 578 bytes). The fixture, commands, and captured output are in the [comparison experiment](../experiments/langchain-comparison/results.md):

```
LangChain chunk 0: char_offset=   0  → file slice: CORRECT
LangChain chunk 1: char_offset= 236  → file slice: WRONG  (off by 13 bytes)
LangChain chunk 2: char_offset= 418  → file slice: WRONG  (off by 24 bytes)
```

By chunk 2, using the character count as a byte count is off by 24 bytes. Store that number as though it were a file offset and the later source highlight is wrong. The metadata does not carry a source-byte hash that would catch the mismatch.

stela tracks byte offsets as it walks through the document. Every chunk gets a `[byteStart, byteEnd)` range and a SHA-256 hash. Before emitting the chunk, the pipeline slices the original file at those offsets, recomputes the hash, and checks they match. If they don't, it throws.

```
stela chunk 0: byte_range=[0, 27)     hash_verified: true
stela chunk 1: byte_range=[29, 40)    hash_verified: true
stela chunk 2: byte_range=[42, 218)   hash_verified: true
...all 7 chunks verified
```

## Why `find()` doesn't work

LangChain splits first, then searches for each chunk's position in the source string afterward. There are a few known ways this breaks.

`find()` needs a search window that identifies the intended occurrence. Duplicate text can make that lookup ambiguous, although the repeated-paragraph fixture in this repository did not reproduce a failure: all 15 LangChain offsets were correct. Other configurations do fail. LangChain's [`TokenTextSplitter` issue #29884](https://github.com/langchain-ai/langchain/issues/29884) shows `-1` offsets when token overlap is later used in a character-position lookup, and [issue #16579](https://github.com/langchain-ai/langchain/issues/16579) records an inconsistent recursive-splitter position. The multi-byte drift above is a separate problem: it appears when a valid character index is treated as a byte index.

stela tracks the byte offset during the split. The position is known at split time. If the byte range doesn't verify against the source, the pipeline refuses to emit the chunk.

## What this means for your vector store

If you're storing `start_index` in a vector database and treating it as a file-byte location, audit that assumption before using it for citations.

I ran a local FAISS benchmark on 15 contracts selected from the CUAD dataset. Across five mutation types, stela's range-and-hash verifier detected all 18,944 chunks the benchmark classified as stale, with no false positives. The baseline stored no per-chunk hash, so it had no equivalent stale-content check. This was not a Pinecone cloud test. The [benchmark results](../experiments/pinecone-integration/baseline-results.md) include the setup and confusion matrix.

The byte ranges also supported multi-strategy retrieval: index sentences, then promote each hit to its enclosing paragraph using byte-range containment. Retrieval overlap went from 37.3% to 50.4% on the 15-contract subset. The containment step depends on both strategies using the same reliable coordinate system. The [optimization results](../experiments/pinecone-integration/optimization-results.md) report the trade-off: overlap improved while precision@5 and IoU@5 decreased slightly.

## Try it

```bash
npx @watthem/stela your-document.txt --strategy paragraph --json
```

You get back chunks with byte ranges and SHA-256 hashes. `sourceBytes.subarray(byteStart, byteEnd)` gives you the exact chunk bytes, and `contentHash` verifies the match. If the slice or hash does not match, the pipeline throws rather than returning a bad offset. Node.js >= 22, zero runtime dependencies.

[@watthem/stela on npm](https://www.npmjs.com/package/@watthem/stela)
