# Real-World Stress Test Results

Tested 2026-09-16 on `perf/pipeline-optimization` branch.

## Datasets

| Dataset | Source | Documents | Total Size |
|---------|--------|-----------|------------|
| Wikipedia-100k | chonkie-ai/wikipedia-100k (HuggingFace) | 100,000 | 447.5 MB |
| SEC 10-K (2024) | PleIAs/SEC (HuggingFace) | 408 | 115.4 MB |

## Speed Results

### Wikipedia-100k (standard chunking benchmark)

| Strategy | Chunks | MB/s | Pass% | Flag% | Confidence | Prov Fails |
|----------|--------|------|-------|-------|------------|------------|
| heading | 100,038 | 59.7 | 93.3 | 6.7 | 0.8436 | 0 |
| paragraph | 1,520,323 | **46.5** | 63.1 | 36.9 | 0.8954 | 0 |
| sentence | 3,403,437 | 34.1 | 97.4 | 2.6 | 0.9879 | 0 |
| token | 341,880 | 24.5 | 90.1 | 9.9 | 0.8300 | 0 |

### SEC 10-K Filings (target vertical)

| Strategy | Chunks | MB/s | Pass% | Flag% | Confidence | Prov Fails |
|----------|--------|------|-------|-------|------------|------------|
| heading | 457 | 55.7 | 61.1 | 38.9 | 0.7944 | 0 |
| paragraph | 194,682 | **49.3** | 22.6 | 77.4 | 0.7745 | 0 |
| sentence | 473,071 | 36.9 | 99.9 | 0.1 | 0.9941 | 0 |
| token | 64,161 | 26.3 | 95.1 | 4.9 | 0.8219 | 0 |

## Competitive Comparison (paragraph strategy)

| Tool | Language | MB/s | Has Provenance |
|------|----------|------|----------------|
| **stela** | **TypeScript** | **46.5** | **Yes (SHA-256 + byte ranges)** |
| Chonkie (token) | Python | 8.54 | No |
| Chonkie (recursive) | Python | 4.82 | No |
| LangChain (recursive) | Python | 7.22 | No |
| LangChain (character) | Python | 4.00 | No |
| LlamaIndex | Python | 0.39 | No |

stela is **5.5-9.6x faster than Chonkie** and **6.4-11.6x faster than LangChain** while being the only tool that provides full provenance (byte-range source mapping + SHA-256 content hashing + quality assessment).

## Provenance Verification

**Zero failures** across all tests:
- Wikipedia: 1,520,323 paragraph chunks verified
- SEC: 194,682 paragraph chunks verified
- Every chunk's `Buffer.from(source).subarray(byteStart, byteEnd).toString() === chunk.text`

## Assessment Calibration Notes

**Wikipedia:** 63.1% pass on paragraph strategy. Flagged chunks are typically short fragments, list items, or structural elements without sentence-ending punctuation. Assessment is correctly identifying incomplete chunks.

**SEC filings:** Only 22.6% pass on paragraph strategy. Analysis shows 77% of flags are due to:
- `mid_word_boundary` (1354/1354 flagged): chunks ending with numbers, abbreviations, structural markers (table of contents, part headers, page numbers)
- `mid_sentence_boundary` (1337/1354): no sentence-ending punctuation — structural fragments

This is the assessment working correctly — SEC filings split by paragraph produce mostly structural fragments, not prose paragraphs. The sentence strategy (99.9% pass) is more appropriate for SEC text.

**Recommendation:** Consider adding a `--lenient` mode or per-vertical threshold profiles rather than adjusting the default thresholds. The current defaults correctly flag low-quality chunks; the signal is valuable.

## Memory Usage

| Dataset | RSS | Heap | Text Size | Ratio |
|---------|-----|------|-----------|-------|
| Wikipedia-100k | 1,113 MB | 847 MB | 447.5 MB | 2.5x |
| SEC 2024 | 660 MB | 412 MB | 115.4 MB | 5.7x |
| 1K Wikipedia | 326 MB | 110 MB | 22.1 MB | 14.8x |

Memory scales sub-linearly with input size. The higher ratio on small inputs is fixed overhead (Node.js runtime ~150 MB). At scale, approaches 2.5x which is acceptable for batch processing.

## Recommendations

1. **Assessment thresholds are good** — don't weaken them. The flag rate on SEC filings tells users "use sentence strategy for this doc type" which is correct advice.
2. **Consider streaming mode** for 100MB+ docs — current approach loads full source into memory.
3. **Consider `--lenient` flag** or vertical-specific profiles for compliance docs where structural fragments are expected.
4. **Node.js ≥22 required** — `crypto.hash()` API. Document this.
