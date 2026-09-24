import pg from 'pg';
export const MODEL = process.env.EMBED_MODEL ?? 'qwen3-embedding:0.6b';
export const OLLAMA = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:stela-local@127.0.0.1:55432/stela',
});
export const toVec = (a) => `[${a.join(',')}]`;

/** Embed texts with Ollama. Qwen3-Embedding wants an instruction on queries only. */
export async function embed(texts, { query = false, truncate = false } = {}) {
  const input = query
    ? texts.map(t => `Instruct: Given a question, retrieve notes that answer it\nQuery: ${t}`)
    : texts;
  const res = await fetch(`${OLLAMA}/api/embed`, {
    method: 'POST',
    body: JSON.stringify({ model: MODEL, input, truncate, keep_alive: '2m' }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
  return (await res.json()).embeddings;
}
