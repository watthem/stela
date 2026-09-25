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

Two ways to look at the index outside the CLI:

```bash
# Agents: an MCP server (stdio, no SDK) with search / related / read tools
claude mcp add stela-rag -e DATABASE_URL=... -e STELA_ROOT=/path/to/indexed/dir -- node "$PWD/mcp.mjs"

# People: Apple's Embedding Atlas over the stored paragraph vectors (no re-embedding)
uv tool install embedding-atlas
~/.local/share/uv/tools/embedding-atlas/bin/python atlas_export.py /somewhere/private/paragraphs.parquet
embedding-atlas /somewhere/private/paragraphs.parquet --vector embedding --text text
```

The Parquet file contains the indexed text. Keep it out of any published repository.

Tracing and keeping the index current:

```bash
node trace.mjs notes/post.md --root /path/to/indexed/dir      # what a note rests on, and what cites it
node reindex.mjs /path/to/indexed/dir --exclude '...' --models qwen3-embedding:0.6b,embeddinggemma
node query.mjs "question" --model embeddinggemma              # search a second model's vectors
```

Citations written inside notes (`path.md#bytes=s-e`, optionally `&sha256=<hex prefix>`) are exposed by the `cites` view. `trace.mjs` walks them backwards (recursively, re-checking each cited range on disk) and forwards (who cites this range). `reindex.mjs` runs chunk → incremental load → embed, so after a small edit only the new paragraphs are embedded.

Agent transcripts (Claude Code keeps every session as JSONL under `~/.claude/projects/`, and by default deletes it after 30 days):

```bash
node transcripts.mjs --out ~/.local/share/stela-transcripts --projects <cwd-slug>,<cwd-slug>
DATABASE_URL=.../transcripts node reindex.mjs ~/.local/share/stela-transcripts --min-verdict pass
```

This renders operator turns, assistant answers and compaction summaries as Markdown, and drops thinking, tool calls and tool results. Each turn ends with its JSONL record uuid. Reruns only append, so a citation into an earlier turn stays valid while the session is still running. On one workstation, 655 MB of JSONL became 7.9 MB of Markdown (251 sessions) in 6 s. Keep the rendered files and their database private: they hold whatever was said in those sessions.

`load.mjs --min-verdict pass` keeps any paragraph that carries a byte-range citation, whatever its verdict. Hash-dense text reads as noise to the quality check, but it is exactly what `cites` and `trace.mjs` need.

Model comparison, same 32 vault queries, paragraph vectors only, glossary prior, collapse on:

| Model | MRR | doc@5 | ans@1500 | ans@500 |
|---|---|---|---|---|
| `qwen3-embedding:0.6b` (1024-dim) | 0.34 | 0.69 | 0.44 | 0.38 |
| `embeddinggemma` 300M (768-dim) | 0.32 | 0.72 | 0.53 | 0.28 |

Dense-only (no lexical, no collapse), EmbeddingGemma leads: MRR 0.34 vs 0.24, ans@1500 0.56 vs 0.50. Neither model wins the full pipeline on every metric, and n=32. The practical result is that a model half the size, which can also run on a phone, costs no measurable quality here.

`--root` re-reads each returned range from disk and compares it byte-for-byte. ✓ means the cited bytes are still what the file contains. ✗ STALE means the file changed after indexing.

`load.mjs` is incremental. Unchanged files (same SHA-256) are skipped, changed files are replaced, and deleted files are removed. Embeddings are cached by the hash of the embedded text, so moved or duplicated text isn't re-embedded.

## Observed (2026-09-24, this corpus)

- stela `docs/` (16 files): 431 paragraphs, 975 sentences. After keeping `pass` paragraphs and dropping sentences identical to their paragraph, 686 chunks were embedded.
- Embedding throughput: **6.39 chunks/s** on a GTX 1060 3GB (Ollama split the model 77% GPU / 23% CPU).
- Chunking a ~3,500-file Markdown tree takes ~14 s and 1.5 GB RSS after making offset conversion linear. The first version re-measured each paragraph prefix per sentence and stalled on a 10 MB file.
- Markdown frontmatter, HTML comments, and query blocks show up as their own paragraphs and are mostly `flag`ged by stela's assessment. `chunk.mjs` now skips a leading YAML frontmatter block (it is metadata, not content).
- `--min-verdict pass` is too strict for notes: stela flags about half of all Markdown paragraphs (14,987 of 29,407), including clean prose, tables, and lists that end in `:` (`mid_sentence_boundary`). The vault index now loads every verdict.

## Evaluating return modes

`eval.mjs` scores `sentence` / `window` / `parent`, with near-duplicate collapse on and off, against a labeled set. Each line of the set is `{"id","query","gold":[{"path","phrase"}]}`, where `phrase` is a verbatim passage that answers the query. A query counts as answered when that passage appears within the first B tokens of context, packed in rank order. It also reports MRR and doc@5. Tokens are approximated as chars/4.

First private run (32 vault queries, 2026-09-24): parent and window tie on answered@1500 (0.41), and window leads at 500 tokens (0.31 vs 0.25). doc@5 is only 0.50, so recall, not the return unit, is the bottleneck on that corpus. With k=20, sentence mode filled only ~970 of 1,500 tokens, so its budget wasn't truly equal. Small n: the gaps are 2–3 queries.

Recall follow-up (same 32 queries, parent mode, collapse on; sentence vectors for newly admitted paragraphs were still pending):

| Change | MRR | doc@5 | ans@1500 | ans@500 |
|---|---|---|---|---|
| baseline (`pass` only) | 0.28 | 0.50 | 0.41 | 0.25 |
| all verdicts, frontmatter skipped | 0.26 | 0.53 | 0.38 | 0.22 |
| + derived snapshot copies excluded | 0.26 | 0.56 | 0.38 | 0.22 |
| + **lexical ORs query terms** | **0.35** | **0.66** | 0.41 | **0.38** |
| + `--prior 'glossary/**=0.5'` | 0.35 | 0.59 | 0.44 | 0.38 |

- The biggest miss was lexical retrieval. `websearch_to_tsquery` ANDs every word of a natural-language question, so for every missed query FTS matched **none** of the gold paragraphs, and "hybrid" was effectively dense-only. ORing the terms (ranked by `ts_rank_cd`) fixed most of it.
- Length-normalizing `ts_rank_cd` made results worse (MRR 0.31 with flag 1, 0.12 with flag 2).
- Admitting all verdicts reached previously gated answers, but diluted the rest.
- Remaining misses are mostly dense misses: the gold paragraph ranks in the hundreds or thousands for questions phrased differently from the note.
- A single "paragraph" can be a 200–300 KB generated list with no blank lines. It matches almost any OR query and fills the budget, which is what the path prior works around. Splitting over-long parents is the real fix.

