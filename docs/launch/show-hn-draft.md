# Show HN draft

Post Tuesday-Thursday, 9AM-12PM ET. Respond to every comment in the first hour.

## Title

Show HN: stela -- byte-range provenance for RAG chunks (TypeScript CLI)

## URL

https://github.com/watthem/stela

## First comment

I built stela because I kept running into the same problem: chunk offsets in RAG pipelines that looked right but pointed at the wrong bytes.

The specific trigger was a French contract where LangChain's `start_index` (a character count) drifted 13 bytes from the actual file position at chunk 2, and 24 bytes by chunk 3. Every accented character adds a byte of drift. The offset is valid as a Python string index -- it just isn't a file-byte offset, and nothing in the metadata tells you which one you have.

stela tracks byte offsets during the split (not after), then verifies each chunk by slicing the source bytes at the recorded range and checking a SHA-256 hash. If the slice doesn't match, it throws instead of returning a bad offset.

The verified experiments:

- LangChain comparison: character vs byte offset drift on non-ASCII text (docs/experiments/langchain-comparison/results.md)
- FAISS benchmark on 15 CUAD contracts: 100% stale chunk detection vs 0% for the baseline, zero false positives (docs/experiments/pinecone-integration/baseline-results.md)
- Retrieval optimization: 37.3% to 50.4% overlap using byte-range containment for multi-strategy retrieval (docs/experiments/pinecone-integration/optimization-results.md)

Honest limitations:

- UTF-8 text only. No PDF/DOCX parsing -- extract text first.
- Node.js >= 22. No Python port.
- Four strategies (paragraph, heading, sentence, word). No token-aware splitting, no semantic chunking.
- Zero runtime deps, which means it doesn't do much besides chunk and verify.

```
npx @watthem/stela your-document.txt --strategy paragraph --json
```

MIT licensed, v0.2.1. Happy to answer questions about the provenance contract or the benchmarks.
