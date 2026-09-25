#!/usr/bin/env node
// Embed chunks that have no embedding yet (parents first). Resumable: stop any time and rerun.
//   node embed.mjs [--kind parent|sentence] [--limit N] [--batch 16] [--model embeddinggemma]
import { createHash } from 'node:crypto';
import { MODEL, PRIMARY, VEC_TABLE, embed, ensureVecTable, pool, toVec } from './db.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const kind = opt('--kind');
const limit = Number(opt('--limit', Infinity));
const batchSize = Number(opt('--batch', 16));
const sha = (s) => createHash('sha256').update(s).digest('hex');

await ensureVecTable();
const pending = PRIMARY ? 'c.embedding IS NULL' : `NOT EXISTS (SELECT 1 FROM ${VEC_TABLE} v WHERE v.id = c.id)`;
let done = 0;
const t0 = Date.now();
while (done < limit) {
  const { rows } = await pool.query(
    `SELECT id, embed_text FROM chunks c WHERE ${pending} ${kind ? 'AND kind=$2' : ''}
     ORDER BY (kind='parent') DESC, doc_path, byte_start LIMIT $1`,
    kind ? [Math.min(batchSize, limit - done), kind] : [Math.min(batchSize, limit - done)]);
  if (!rows.length) break;
  const texts = rows.map(r => r.embed_text || ' ');
  let vecs;
  try { vecs = await embed(texts); } catch (err) {
    if (!/exceeds the context length/.test(err.message)) throw err;
    // One oversized chunk fails the whole batch: embed singly, truncating only the chunks that overflow.
    vecs = [];
    for (let i = 0; i < texts.length; i++) {
      try { vecs.push((await embed([texts[i]]))[0]); } catch (e) {
        if (!/exceeds the context length/.test(e.message)) throw e;
        console.error(`truncated ${rows[i].id} (${texts[i].length} chars)`);
        vecs.push((await embed([texts[i]], { truncate: true }))[0]);
      }
    }
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < rows.length; i++) {
      const v = toVec(vecs[i]);
      if (!PRIMARY) { await client.query(`INSERT INTO ${VEC_TABLE} VALUES ($1,$2) ON CONFLICT DO NOTHING`, [rows[i].id, v]); continue; }
      await client.query('UPDATE chunks SET embedding=$1 WHERE id=$2', [v, rows[i].id]);
      await client.query(`INSERT INTO embedding_cache (embed_sha256, model, embedding) VALUES ($1,$2,$3)
        ON CONFLICT DO NOTHING`, [sha(rows[i].embed_text), MODEL, v]);
    }
    await client.query('COMMIT');
  } finally { client.release(); }
  done += rows.length;
  if (done % (batchSize * 25) < batchSize) {
    const rate = done / ((Date.now() - t0) / 1000);
    console.error(`${done} embedded, ${rate.toFixed(1)} chunks/s`);
  }
}
const secs = (Date.now() - t0) / 1000;
const left = (await pool.query(`SELECT count(*)::int n FROM chunks c WHERE ${pending}`)).rows[0].n;
console.log(JSON.stringify({ embedded: done, seconds: +secs.toFixed(1), chunks_per_s: +(done / secs).toFixed(2), remaining: left }));
await pool.end();
