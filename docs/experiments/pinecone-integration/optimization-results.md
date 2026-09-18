# Retrieval Optimization Results

## Experiment

Incremental optimization of the stela + FAISS retrieval pipeline on 15 CUAD contracts.
Each row adds one optimization on top of the previous row's configuration.

- **Dataset**: CUAD (Contract Understanding Atticus Dataset), 15 contracts, 242 queries with answers
- **Embedding model**: sentence-transformers/all-MiniLM-L6-v2 (22M params)
- **Vector store**: FAISS (local, CPU)
- **Retrieval**: top-5, cosine similarity (inner product on L2-normalized vectors)

## Results

| Configuration | Retrieval Overlap | Precision@5 | IoU@5 | Complete-Grounding@5 | Clause-Intact | Time |
|---|---|---|---|---|---|---|
| stela paragraph (baseline) | 37.3% | 7.6% | 6.7% | 36.7% | 95.5% | 269s |
| + strip boilerplate | 38.4% (+1.1pp) | 8.4% | 7.2% | 37.3% | 95.5% | 268s |
| + multi-strategy promotion | **50.4% (+13.1pp)** | 6.5% | 6.1% | **50.1%** | 95.5% | 316s |
| + hybrid BM25 (RRF) | 49.2% (+11.9pp) | 6.3% | 5.9% | 47.4% | 95.5% | 315s |

**Best configuration**: strip-boilerplate + multi-strategy (without BM25 hybrid)

Total retrieval overlap improvement: **37.3% -> 50.4% (+13.1 percentage points, +35% relative)**

## Per-optimization analysis

### 1. Strip CUAD query boilerplate (+1.1pp)

CUAD queries start with ~110 characters of boilerplate template text:

> "Highlight the parts (if any) of this contract related to "X" that should be reviewed by a lawyer. Details: ..."

MiniLM's tokenizer has a 256-token window. The boilerplate consumes roughly half of this capacity, diluting the semantic signal of the actual query (which follows "Details: "). Stripping this prefix frees the embedding to focus on the meaningful question.

The improvement is modest (+1.1pp) but consistent, and costs nothing at runtime.

### 2. Multi-strategy byte-range promotion (+12.0pp over strip-boilerplate)

This is the largest single improvement and the key stela-unique technique:

1. Run stela with `--strategy sentence` and `--strategy paragraph` on each contract
2. Index the sentence-level chunks in FAISS (finer granularity = better retrieval precision)
3. After retrieving top-20 sentence hits, promote each to its enclosing paragraph by byte-range containment: a sentence chunk `[s_start, s_end)` is inside paragraph `[p_start, p_end)` when `p_start <= s_start` and `s_end <= p_end`
4. Dedup promoted paragraphs (>= 75% overlap of shorter span keeps only the higher-scoring one)
5. Return top-5 unique promoted regions

This works because sentence-level embeddings match queries more precisely (less noise from surrounding context), while paragraph-level output provides the full clause context needed for grounding. The byte-range provenance that stela provides is what makes the promotion step possible without re-chunking or string matching.

Notable per-document improvements with this technique:
- contract_10 (Goosehead Insurance): 13.0% -> 36.0% (+23pp)
- contract_15 (Todos Medical): 39.1% -> 84.8% (+46pp)
- contract_14 (Conformis): 37.6% -> 50.1% (+12.5pp)
- contract_01 (Xencor): 19.5% -> 47.5% (+28pp)
- contract_05 (Sucampo): 38.7% -> 50.0% (+11.3pp)

### 3. BM25 + dense hybrid with RRF (-1.2pp)

Adding BM25 (Okapi) scoring with Reciprocal Rank Fusion (k=60) over top-20 candidates from each signal **slightly hurt** performance (50.4% -> 49.2%).

This is likely because:
- CUAD contract queries are already semantically distinctive (after boilerplate removal)
- BM25's term-matching surface is noisy on legal text where common terms (agreement, party, shall) dominate
- RRF dilutes the dense signal by promoting BM25-only hits that don't semantically match the query intent

BM25 hybrid may still help with a better tokenizer (legal-domain BPE or subword matching), or with a reranker stage, but with vanilla whitespace tokenization it does not improve retrieval here.

### 4. Precision@5 and IoU@5 trade-off

Multi-strategy promotion increases retrieval overlap (recall) substantially but slightly decreases precision@5 and IoU@5. This is expected: promoting sentence hits to enclosing paragraphs brings in more text, which improves recall (more ground-truth characters are covered) but also includes more non-relevant context surrounding the target clause, lowering precision.

This is the right trade-off for RAG pipelines where the LLM needs enough surrounding context to reason about the clause.

### 5. Clause-intact rate

The clause-intact rate (95.5%) is unchanged across all configurations because it depends only on the paragraph-level chunk boundaries, which are the same throughout.

## Embedding model upgrade: Qwen3-Embedding-0.6B

Qwen/Qwen3-Embedding-0.6B (600M params, 1024-dim embeddings) loads successfully on CPU and produces correct embeddings. However, at ~27x the parameter count of MiniLM (22M), inference is too slow for the full 15-contract benchmark on CPU:

- MiniLM: ~270s for 242 queries across 5893 chunks
- Qwen3 estimated: ~2+ hours (extrapolated from initial chunk embedding times)

The model would need GPU acceleration (CUDA CC >= 7.0) to be practical. A GTX 1060 (CC 6.1) is below the minimum for the installed PyTorch build.

**Recommendation**: Test Qwen3 on a subset (3-5 contracts) in a GPU-enabled environment to measure the embedding quality improvement before committing to the longer pipeline.

## Metric definitions

- **Retrieval Overlap**: fraction of ground-truth annotation characters covered by top-5 retrieved chunks (character-level recall)
- **Precision@5**: fraction of retrieved content (by characters) that overlaps with any ground-truth span
- **IoU@5**: intersection over union at the character level between retrieved chunks and ground-truth spans
- **Clause-Intact Rate**: fraction of gold spans fully contained within a single paragraph chunk (boundary preservation)
- **Complete-Grounding@5**: fraction of gold spans fully covered by the union of top-5 retrieved chunks

## Reproduction

```bash
cd docs/experiments/pinecone-integration

# Baseline (verify 37.3%)
.venv/bin/python scripts/optimized_pipeline.py

# Best configuration (50.4%)
.venv/bin/python scripts/optimized_pipeline.py --strip-boilerplate --multi-strategy

# All optimizations
.venv/bin/python scripts/optimized_pipeline.py --strip-boilerplate --multi-strategy --hybrid-bm25

# With alternative embedding model (CPU-slow)
.venv/bin/python scripts/optimized_pipeline.py --strip-boilerplate --multi-strategy \
  --embedding-model Qwen/Qwen3-Embedding-0.6B
```
