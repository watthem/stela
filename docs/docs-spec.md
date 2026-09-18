# Documentation spec

What the public-facing stela documentation should contain, how it should be structured, and what each section needs to accomplish. This guides whoever writes the docs (human or agent).

## Audience

Small-team engineers (2-50 people) who consume RAG as a tool, not build retrieval systems as a core product. They've been asked "where did that answer come from?" and didn't have a good answer. They use LangChain, LlamaIndex, or Pinecone as consumers. They're comfortable with a CLI and npm but don't want to read source code to understand what a tool does.

## Tone

Technical, direct, no marketing language. Show what the tool does by running it and showing the output. Let the reader decide if they need it. Don't oversell the quality heuristics — they're heuristics, not guarantees.

## Structure

### 1. Landing page (README.md, npm page)

Already exists. Keep it concise. It should answer in 30 seconds:
- What does this do? (one line)
- How do I try it? (`npx` command)
- What do I get back? (byte ranges + hashes)
- What doesn't it do? (not a tokenizer, not a PDF extractor)

### 2. How it works

The core explainer. Walk through what happens when you run `stela README.md`. Cover:

- Input goes in (the file, raw UTF-8 bytes)
- Splitting happens (by paragraph, heading, sentence, or word)
- Each chunk gets byte offsets tracked during the split, not after
- Each chunk gets a SHA-256 hash of its bytes
- Verification: slice the source at those offsets, compare, hash-check
- Output comes out (NDJSON or JSON with provenance metadata)

Emphasize the "during, not after" distinction. That's the architectural difference from LangChain's `start_index`. That's the whole point.

### 3. The provenance contract

Standalone page explaining exactly what the byte ranges and hashes mean:
- Zero-based, half-open `[start, end)`
- No normalization — verbatim slices
- What `hashVerified: true` proves and what it doesn't prove
- How to independently verify: `source.slice(byteStart, byteEnd)` should equal the chunk's UTF-8 bytes
- Buffer vs. string input differences

This page should be referenceable from other docs and blog posts. It's the trust anchor.

### 4. CLI reference

Flag-by-flag reference with examples and sample output. Already partially in the README. Expand with:
- One example per strategy showing real output
- `--stats` output explained
- `--no-validate` behavior (still verifies bytes, skips quality heuristics)
- Error messages and what they mean (malformed UTF-8, binary rejection, etc.)

### 5. Library API reference

For developers importing `@watthem/stela` into their code:
- `run()` — full pipeline with provenance
- `splitByHeading`, `splitByParagraph`, `splitBySentence`, `splitByWord` — text-only, no provenance
- The `PipelineResult` and `Chunk` types, field by field
- Example: plugging stela output into a vector store

### 6. Why not X?

Comparison page. Not attack-y, just factual:
- **vs. LangChain's start_index:** split-then-find vs. track-during-split. Duplicate substring bug. Token splitter offset mismatch.
- **vs. Chonkie:** Chonkie is a fast Python chunker. stela adds provenance. Different goals — speed vs. traceability.
- **vs. Unstructured:** Unstructured is a document extraction pipeline. stela is a post-extraction chunker. They're complementary.
- **vs. building it yourself:** You'll need to handle UTF-8 byte mapping, surrogate pairs, CRLF normalization edge cases, and verification. stela does this in ~500 lines with tests.

### 7. Integration guides

See `integrations-spec.md` — each guide requires a working example with real evidence before it gets written. No guide without a proven experiment behind it.

## What to avoid

- Don't document internal implementation details that could change (function signatures in chunk.ts, etc.)
- Don't use "revolutionary," "game-changing," or any marketing adjectives
- Don't claim stela proves factual accuracy — it proves byte-range integrity
- Don't assume the reader knows what RAG is. One sentence is enough: "Retrieval-augmented generation pulls chunks of text from documents to give an LLM context for answering questions."

## Hosting

TBD. Options: GitHub Pages (if repo goes public), a subdomain of matthewhendricks.net, or the npm README as the sole surface. No decision needed yet — write the content first, figure out where it lives later.
