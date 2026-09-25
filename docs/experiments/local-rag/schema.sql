-- stela local RAG: provenance-first schema (Postgres 17 + pgvector 0.8).
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS documents (
  doc_path    text PRIMARY KEY,               -- path relative to the indexed root
  doc_sha256  char(64) NOT NULL,              -- whole-file hash; change => re-chunk
  indexed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chunks (
  id              text PRIMARY KEY,           -- kind:docsha16:start-end
  kind            text NOT NULL CHECK (kind IN ('parent', 'sentence')),
  parent_id       text REFERENCES chunks(id) ON DELETE CASCADE,
  doc_path        text NOT NULL REFERENCES documents ON DELETE CASCADE,
  byte_start      bigint NOT NULL,            -- zero-based, half-open, UTF-8 bytes
  byte_end        bigint NOT NULL,
  content_sha256  char(64) NOT NULL,          -- hash of source[byte_start:byte_end]
  verdict         text,                       -- stela assessment (parents only)
  text            text NOT NULL,              -- verbatim source slice
  embed_text      text NOT NULL,              -- wikilinks stripped; what gets embedded
  tsv             tsvector GENERATED ALWAYS AS (to_tsvector('english', embed_text)) STORED,
  embedding       halfvec(1024),
  CHECK (byte_end > byte_start)
);
CREATE INDEX IF NOT EXISTS chunks_parent ON chunks (parent_id);
CREATE INDEX IF NOT EXISTS chunks_doc ON chunks (doc_path);
CREATE INDEX IF NOT EXISTS chunks_tsv ON chunks USING gin (tsv);
CREATE INDEX IF NOT EXISTS chunks_hnsw ON chunks USING hnsw (embedding halfvec_cosine_ops);

-- Embeddings keyed by what was embedded, so moving or duplicating text never re-embeds it.
CREATE TABLE IF NOT EXISTS embedding_cache (
  embed_sha256  char(64) NOT NULL,
  model         text NOT NULL,
  embedding     halfvec(1024) NOT NULL,
  PRIMARY KEY (embed_sha256, model)
);

-- Byte-range citations written inside indexed text (path.md#bytes=s-e[&sha256=hex]).
-- A view, so it always matches the current index; trace.mjs walks it in both directions.
-- The path part is greedy on purpose: in Postgres the first quantifier sets the whole RE's
-- greediness, and a lazy path made (\d+) lazy too (bytes=0-31 matched as 0-3).
CREATE OR REPLACE VIEW cites AS
SELECT c.id AS from_id, c.doc_path AS from_path, m[1] AS to_path,
       m[2]::bigint AS to_start, m[3]::bigint AS to_end, m[4] AS to_sha256
FROM chunks c,
     regexp_matches(c.text, '([^\s()<>\[\]`"''|#]+\.md)#bytes=(\d+)-(\d+)(?:&sha256=([0-9a-f]{8,64}))?', 'g') AS m
WHERE c.kind = 'parent';
