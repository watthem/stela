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
