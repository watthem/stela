# Retrieval overlap went up 13 points by promoting sentences to paragraphs

I ran a retrieval benchmark on 15 CUAD legal contracts with MiniLM embeddings in FAISS. Paragraph chunks with stela provenance gave 37.3% retrieval overlap. I switched to retrieving at sentence granularity, then promoting each hit back to its enclosing paragraph using byte-range containment. That got 50.4%.

## The setup

The [experiment](../experiments/pinecone-integration/README.md) uses 15 contracts from the CUAD dataset, 242 queries with ground truth answer spans. Embeddings are `all-MiniLM-L6-v2` (22M params, local CPU). Vector store is FAISS, top-5 cosine similarity. No paid APIs involved.

Baseline: `stela --strategy paragraph` on each contract. 37.3% retrieval overlap, meaning the top-5 chunks covered 37.3% of the ground truth annotation characters across all queries.

## The promotion trick

1. Chunk each contract at both sentence and paragraph granularity with stela
2. Index sentence-level chunks in FAISS (smaller chunks match queries more precisely)
3. Retrieve top-20 sentence hits, then promote each to its enclosing paragraph by byte-range containment: sentence `[s_start, s_end)` is inside paragraph `[p_start, p_end)` when `p_start <= s_start` and `s_end <= p_end`

Dedup overlapping paragraphs at 75% overlap, return top-5.

Step 3 only works if byte ranges from both strategies are in the same coordinate system and are actually correct. stela tracks byte offsets during the split and verifies them with SHA-256 before emitting, so the containment check doesn't need string matching or re-parsing.

## Results

[Full results](../experiments/pinecone-integration/optimization-results.md):

| Configuration | Retrieval Overlap | Precision@5 | Complete-Grounding@5 |
|---|---|---|---|
| stela paragraph (baseline) | 37.3% | 7.6% | 36.7% |
| + strip boilerplate | 38.4% (+1.1pp) | 8.4% | 37.3% |
| + multi-strategy promotion | **50.4% (+13.1pp)** | 6.5% | **50.1%** |
| + hybrid BM25 (RRF) | 49.2% (-1.2pp) | 6.3% | 47.4% |

A few contracts moved a lot: Todos Medical went from 39.1% to 84.8%. Xencor from 19.5% to 47.5%. Goosehead Insurance from 13.0% to 36.0%.

Precision@5 and IoU@5 went down slightly. Promoting to paragraphs covers more ground truth characters but also pulls in surrounding context outside the annotated span. For RAG pipelines where the LLM needs clause-level context to reason about the answer, I'd take the recall. If you need tight extraction, stay at sentence level.

## BM25 hybrid made things worse

I tried BM25 with Reciprocal Rank Fusion (k=60) on top of multi-strategy promotion. It dropped retrieval overlap by 1.2pp. Legal text is full of "agreement," "party," and "shall," which give BM25 a noisy signal. The dense embeddings were already doing fine after boilerplate removal, and fusing in BM25 just diluted them.

## Caveats

A larger embedding model (Qwen3-Embedding-0.6B, 600M params) loaded but was too slow on CPU for the full benchmark. Needs a GPU with CUDA CC >= 7.0. I also only tested local FAISS. Pinecone cloud, different distance metrics, or approximate nearest neighbor configs might change things.

## Reproduce it

```bash
cd docs/experiments/pinecone-integration

# Baseline (37.3%)
.venv/bin/python scripts/optimized_pipeline.py

# Best configuration (50.4%)
.venv/bin/python scripts/optimized_pipeline.py --strip-boilerplate --multi-strategy
```

Setup and dependencies are in the [experiment README](../experiments/pinecone-integration/README.md). Per-document breakdowns and metric definitions are in the [optimization results](../experiments/pinecone-integration/optimization-results.md).

[@watthem/stela on npm](https://www.npmjs.com/package/@watthem/stela)
