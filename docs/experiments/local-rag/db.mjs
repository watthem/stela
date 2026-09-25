import pg from 'pg';
// Embedding profiles. The first model writes chunks.embedding (and the cache); any other model
// writes a side table emb_<slug>(id, embedding), so several models can be compared on one index.
const PROFILES = {
  'qwen3-embedding:0.6b': { dim: 1024, query: (t) => `Instruct: Given a question, retrieve notes that answer it\nQuery: ${t}`, doc: (t) => t },
  'embeddinggemma': { dim: 768, query: (t) => `task: search result | query: ${t}`, doc: (t) => `title: none | text: ${t}` },
};
const argModel = (() => { const i = process.argv.indexOf('--model'); return i >= 0 ? process.argv[i + 1] : undefined; })();
export const MODEL = argModel ?? process.env.EMBED_MODEL ?? 'qwen3-embedding:0.6b';
export const PROFILE = PROFILES[MODEL] ?? (() => { throw new Error(`unknown model ${MODEL}; known: ${Object.keys(PROFILES).join(', ')}`); })();
export const PRIMARY = MODEL === 'qwen3-embedding:0.6b';
/** Where this model's vectors live: a relation with (id, embedding). */
export const VEC_TABLE = PRIMARY ? 'chunks' : `emb_${MODEL.replace(/[^a-z0-9]+/gi, '_')}`;
export const OLLAMA = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:stela-local@127.0.0.1:55432/stela',
});
export const toVec = (a) => `[${a.join(',')}]`;

/** Embed texts with Ollama, applying the model's query/document prompt. */
export async function embed(texts, { query = false, truncate = false } = {}) {
  const input = texts.map(query ? PROFILE.query : PROFILE.doc);
  const res = await fetch(`${OLLAMA}/api/embed`, {
    method: 'POST',
    body: JSON.stringify({ model: MODEL, input, truncate, keep_alive: '2m' }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
  return (await res.json()).embeddings;
}

/** Create the side table for a non-primary model. */
export async function ensureVecTable() {
  if (PRIMARY) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS ${VEC_TABLE} (
    id text PRIMARY KEY REFERENCES chunks ON DELETE CASCADE, embedding halfvec(${PROFILE.dim}) NOT NULL)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS ${VEC_TABLE}_hnsw ON ${VEC_TABLE} USING hnsw (embedding halfvec_cosine_ops)`);
}
