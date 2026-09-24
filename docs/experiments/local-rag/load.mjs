#!/usr/bin/env node
// Load chunk.mjs output into Postgres. Incremental: unchanged documents (same sha256) are
// skipped, changed ones are replaced, missing ones are deleted. Embeddings are reused from
// embedding_cache when the embedded text is identical.
//   node load.mjs chunks.ndjson [--exclude-path path,path] [--min-verdict pass]
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { MODEL, pool } from './db.mjs';

const [file, ...rest] = process.argv.slice(2);
const opt = (n) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : undefined; };
const excluded = new Set((opt('--exclude-path') ?? '').split(',').filter(Boolean));
const passOnly = opt('--min-verdict') === 'pass';

const docs = new Map();
for await (const line of createInterface({ input: createReadStream(file) })) {
  if (!line) continue;
  const r = JSON.parse(line);
  if (excluded.has(r.doc_path)) continue;
  if (!docs.has(r.doc_path)) docs.set(r.doc_path, { sha: r.doc_sha256, rows: [] });
  docs.get(r.doc_path).rows.push(r);
}

const db = await pool.connect();
const existing = new Map((await db.query('SELECT doc_path, doc_sha256 FROM documents')).rows
  .map(r => [r.doc_path, r.doc_sha256]));
let replaced = 0, unchanged = 0, removed = 0, inserted = 0;
await db.query('BEGIN');
for (const path of existing.keys()) {
  if (!docs.has(path)) { await db.query('DELETE FROM documents WHERE doc_path=$1', [path]); removed++; }
}
for (const [path, { sha: docSha, rows }] of docs) {
  if (existing.get(path) === docSha) { unchanged++; continue; }
  await db.query('DELETE FROM documents WHERE doc_path=$1', [path]);
  await db.query('INSERT INTO documents (doc_path, doc_sha256) VALUES ($1,$2)', [path, docSha]);
  const keepParents = new Set(rows.filter(r => r.kind === 'parent' && (!passOnly || r.verdict === 'pass')).map(r => r.id));
  const keep = rows.filter(r => keepParents.has(r.kind === 'parent' ? r.id : r.parent_id));
  // Parents before sentences so the FK holds; sentences equal to their parent are dropped.
  for (const kind of ['parent', 'sentence']) {
    const batch = keep.filter(r => r.kind === kind
      && !(kind === 'sentence' && r.id.slice(2) === r.parent_id.slice(2)));
    for (let i = 0; i < batch.length; i += 500) {
      const part = batch.slice(i, i + 500);
      const values = [], params = [];
      part.forEach((r, j) => {
        const b = j * 10;
        values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10})`);
        params.push(r.id, r.kind, r.parent_id, path, r.byte_start, r.byte_end, r.content_sha256, r.verdict, r.text, r.embed_text);
      });
      await db.query(`INSERT INTO chunks (id,kind,parent_id,doc_path,byte_start,byte_end,content_sha256,verdict,text,embed_text) VALUES ${values.join(',')} ON CONFLICT (id) DO NOTHING`, params);
      inserted += part.length;
    }
  }
  replaced++;
}
// Reuse cached embeddings for identical embedded text.
const reused = await db.query(`UPDATE chunks c SET embedding = e.embedding FROM embedding_cache e
  WHERE c.embedding IS NULL AND e.model=$1 AND e.embed_sha256 = encode(sha256(convert_to(c.embed_text,'UTF8')),'hex')`, [MODEL]);
await db.query('COMMIT');
db.release();
const pending = (await pool.query('SELECT kind, count(*)::int n FROM chunks WHERE embedding IS NULL GROUP BY kind')).rows;
console.log(JSON.stringify({ documents: docs.size, replaced, unchanged, removed, inserted, reused_embeddings: reused.rowCount, pending }));
await pool.end();
