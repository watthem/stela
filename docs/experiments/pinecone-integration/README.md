# Pinecone Integration Experiment: Baseline Benchmarks

Measures whether adding byte-range provenance (stela) to chunks stored in a
vector database enables verifiable citations and stale-document detection that
the standard RAG chunking pipeline cannot provide.

## Prerequisites

- Node.js >= 22 (for stela CLI)
- Python 3.12+
- The stela package at `/home/watthem/Code/stela/` (or `npx @watthem/stela`)

## Setup

```bash
cd docs/experiments/pinecone-integration

# Create virtual environment and install dependencies
python3 -m venv .venv
.venv/bin/pip install sentence-transformers faiss-cpu langchain-text-splitters
```

## Dataset

15 contracts from the CUAD (Contract Understanding Atticus Dataset), selected
for diversity:

- Contracts with repeated boilerplate paragraphs
- Contracts with non-ASCII characters (accented names, Unicode)
- A mix of lengths: 645 chars to 338K chars

Contracts are in `data/contracts/`. CUAD annotations (question/answer spans) are
in `data/annotations.json`. The selection manifest is in `data/manifest.json`.

## Running

All scripts should be run from this directory.

### 1. Generate mutations

```bash
python3 scripts/mutate.py data/contracts/ data/mutated/
```

Produces five variants of each contract: CRLF line endings, single-word typo fix,
inserted paragraph, smart-quote substitution, and whitespace collapse. Output goes
to `data/mutated/` with a `data/mutation_log.json` recording hashes.

### 2. Run the baseline pipeline

```bash
CUDA_VISIBLE_DEVICES="" .venv/bin/python scripts/baseline_pipeline.py
```

Uses LangChain `RecursiveCharacterTextSplitter(500, 50)` + `all-MiniLM-L6-v2`
embeddings + FAISS. Results are saved to `results/baseline_results.json`.

### 3. Run the stela pipeline

```bash
CUDA_VISIBLE_DEVICES="" .venv/bin/python scripts/stela_pipeline.py
```

Uses `stela --strategy paragraph` + same embeddings + FAISS. Results are saved to
`results/stela_results.json`.

### 4. Compare results

```bash
.venv/bin/python scripts/compare.py
```

Prints a summary table and writes `baseline-results.md`.

## What is measured

| Metric | Definition |
|--------|-----------|
| **Locator verification** | Can you slice the source file at the stored offset and recover the chunk? Baseline uses character `start_index`; stela uses byte `[byteStart:byteEnd]` + SHA-256 hash. |
| **Stale detection TPR** | After mutating the source document, what fraction of actually-stale chunks are detected? Baseline has no per-chunk verification mechanism (TPR = 0%); stela compares content hashes. |
| **Stale detection FPR** | What fraction of unchanged chunks are incorrectly flagged as stale? |
| **Retrieval overlap** | What fraction of CUAD ground-truth annotation characters are covered by the top-5 retrieved chunks? |

## Notes

- `CUDA_VISIBLE_DEVICES=""` forces CPU inference. The local GPU (GTX 1060) has a
  CUDA compute capability too old for the installed PyTorch.
- No paid APIs are used. Embeddings are local (`all-MiniLM-L6-v2`), vector store
  is FAISS in-memory. Pinecone cloud integration will be added in a later phase.
- The stela pipeline shells out to `npx @watthem/stela` for each file. This is
  slower than the baseline but measures the real CLI path.
