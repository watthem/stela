# Local RAG with provenance: stela → Postgres + pgvector

Status: **experiment**. It prototypes three ideas before they reach `src/`:

1. **Parent mapping.** Sentences are segmented *inside* each paragraph and carry a `parent_id`, so a sentence hit promotes to its paragraph with a lookup instead of a containment scan.
2. **Wrap-aware sentence segmentation.** `Intl.Segmenter` breaks a sentence at every line feed (UAX #29 rule SB4), so hard-wrapped prose (`"…is hard\nwrapped…"`) comes back as line fragments. `chunk.mjs` segments a copy where a lone LF between prose lines becomes a space (same byte length) and slices the original bytes. Chunk text stays verbatim and offsets stay exact.
3. **Heading attachment.** A paragraph that is only a Markdown heading (`# Bacon`) is merged into the paragraph that follows it. The merged parent is one contiguous byte range, so provenance stays exact. The heading line is not emitted as its own sentence. A heading at the end of a file, with nothing after it, stays on its own.

Everything runs locally with no paid services.

| Piece | Choice | Why |
|---|---|---|
| Chunking | `@watthem/stela` 0.2.1, paragraph strategy + in-paragraph sentences | exact byte ranges and SHA-256 per chunk |
| Embeddings | `qwen3-embedding:0.6b` via Ollama (1024-dim, 32k context) | open weights (Apache-2.0); long context means word-sized chunks aren't truncated |
| Store | Postgres 17 + pgvector 0.8.6 (`halfvec(1024)`, HNSW, iterative scan) | provenance columns + parent join + full-text search in one database |
| Lexical | Postgres `tsvector` + `ts_rank_cd` | no extra service; not BM25 |
| Fusion | reciprocal rank fusion, k=60 | standard, parameter-light |
| Diversity | collapse near-duplicate parents (same opening words + cosine ≥ 0.75, or cosine ≥ 0.97) | templated lines and snapshot copies otherwise fill the top k; collapsed hits are listed under `similar` |

## Run

```bash
docker run -d --name stela-pgvector -p 127.0.0.1:55432:5432 \
  -e POSTGRES_PASSWORD=stela-local -e POSTGRES_DB=stela \
  -v stela-pgvector-data:/var/lib/postgresql/data pgvector/pgvector:pg17
docker exec -i stela-pgvector psql -U postgres -d stela < schema.sql
ollama pull qwen3-embedding:0.6b
npm install

node chunk.mjs ../.. --out chunks.ndjson --exclude 'experiments/**'   # stela's own docs
node load.mjs chunks.ndjson --min-verdict pass    # incremental; rerun after edits (--force after chunker changes)
node embed.mjs                                    # resumable
node query.mjs "does stela normalize unicode?" --return window --root ../..
node eval.mjs queries.jsonl --budget 1500,500    # score sentence/window/parent at equal token budget
```

`--root` re-reads each returned range from disk and compares it byte-for-byte. ✓ means the cited bytes are still what the file contains. ✗ STALE means the file changed after indexing.

`load.mjs` is incremental. Unchanged files (same SHA-256) are skipped, changed files are replaced, and deleted files are removed. Embeddings are cached by the hash of the embedded text, so moved or duplicated text isn't re-embedded.

## Observed (2026-09-24, this corpus)

- stela `docs/` (16 files): 431 paragraphs, 975 sentences. After keeping `pass` paragraphs and dropping sentences identical to their paragraph, 686 chunks were embedded.
- Embedding throughput: **6.39 chunks/s** on a GTX 1060 3GB (Ollama split the model 77% GPU / 23% CPU).
- Chunking a ~3,500-file Markdown tree takes ~14 s and 1.5 GB RSS after making offset conversion linear. The first version re-measured each paragraph prefix per sentence and stalled on a 10 MB file.
- Markdown frontmatter, HTML comments, and query blocks show up as their own paragraphs and are mostly `flag`ged by stela's assessment. Treating frontmatter as metadata rather than a chunk is a candidate improvement.

Not yet measured: retrieval quality on a labeled set, and bounded expansion (`sentence` / `window` / `parent`) at an equal token budget. Treat the return modes as mechanics, not results.

## Evaluating return modes

`eval.mjs` scores `sentence` / `window` / `parent`, with near-duplicate collapse on and off, against a labeled set. Each line of the set is `{"id","query","gold":[{"path","phrase"}]}`, where `phrase` is a verbatim passage that answers the query. A query counts as answered when that passage appears within the first B tokens of context, packed in rank order. It also reports MRR and doc@5. Tokens are approximated as chars/4.

First private run (32 vault queries, 2026-09-24): parent and window tie on answered@1500 (0.41), and window leads at 500 tokens (0.31 vs 0.25). doc@5 is only 0.50, so recall, not the return unit, is the bottleneck on that corpus. With k=20, sentence mode filled only ~970 of 1,500 tokens, so its budget wasn't truly equal. Small n: the gaps are 2–3 queries.

