#!/usr/bin/env node
// Hybrid retrieval with provenance: dense (pgvector) + lexical (Postgres FTS), fused with RRF.
// Search sentences and parents, then return context per --return:
//   sentence  the matched unit only
//   window    matched sentence ±1 neighbor inside its parent (merged byte range)
//   parent    the whole enclosing paragraph
// Every result is an exact byte range of a source file plus its SHA-256.
//   node query.mjs "question" [--k 5] [--return window] [--json] [--root <indexed-dir>]
// --root re-reads every returned range from disk and checks it byte-for-byte (stale => ✗).
// Near-duplicate parents collapse into the best-ranked one and are listed under `similar`:
// templated lines (same opening words once dates/IDs are stripped, cosine >= 0.75) and
// copies (cosine >= 0.97). --no-collapse turns this off.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { embed, pool, toVec } from './db.mjs';

const args = process.argv.slice(2);
const q = args.find(a => !a.startsWith('--') && !/^\d+$/.test(a) && !['sentence', 'window', 'parent'].includes(a));
if (!q) { console.error('usage: query.mjs "question" [--k 5] [--return sentence|window|parent] [--json]'); process.exit(2); }
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const k = Number(opt('--k', 5));
const mode = opt('--return', 'window');
const asJson = args.includes('--json');
const root = opt('--root');
const collapse = !args.includes('--no-collapse');

await pool.query('SET hnsw.ef_search = 100');
await pool.query("SET hnsw.iterative_scan = 'relaxed_order'");
const [qv] = await embed([q], { query: true });

// RRF over two ranked lists (k=60). Candidates: 50 dense + 50 lexical.
const { rows: hits } = await pool.query(`
  WITH dense AS (
    SELECT id, row_number() OVER (ORDER BY embedding <=> $1::halfvec) AS r
    FROM (SELECT id, embedding FROM chunks WHERE embedding IS NOT NULL
          ORDER BY embedding <=> $1::halfvec LIMIT 50) d
  ), lexical AS (
    SELECT id, row_number() OVER (ORDER BY ts_rank_cd(tsv, query) DESC) AS r
    FROM chunks, websearch_to_tsquery('english', $2) query
    WHERE tsv @@ query ORDER BY ts_rank_cd(tsv, query) DESC LIMIT 50
  ), fused AS (
    SELECT id, sum(1.0 / (60 + r)) AS score FROM (
      SELECT * FROM dense UNION ALL SELECT * FROM lexical) u GROUP BY id
  )
  SELECT c.id, c.kind, c.parent_id, c.doc_path, c.byte_start, c.byte_end, c.text, f.score,
         (SELECT r FROM dense WHERE dense.id = c.id) AS dense_rank,
         (SELECT r FROM lexical WHERE lexical.id = c.id) AS lexical_rank
  FROM fused f JOIN chunks c USING (id) ORDER BY f.score DESC LIMIT 100`, [toVec(qv), q]);

// Opening words with dates, hashes, numbers, links and markup removed: equal for templated lines.
const opening = (t) => t.toLowerCase()
  .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/https?:\S+/g, ' ')
  .replace(/\b[0-9a-f]{7,40}\b/g, ' ').replace(/[^a-z]+/g, ' ').trim().split(' ').slice(0, 6).join(' ');
const cosine = (a, b) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return d / Math.sqrt(x * y); };

// Promote each hit to its parent; keep the best-scoring hit per parent, then collapse near-duplicates.
const byParent = new Map();
const kept = [];   // { pid, open, vec }
for (const h of hits) {
  const pid = h.kind === 'parent' ? h.id : h.parent_id;
  if (byParent.has(pid) || kept.some(x => x.similar?.includes(pid))) continue;
  if (collapse) {
    const { rows: [p] } = await pool.query('SELECT text, embedding::text AS v FROM chunks WHERE id=$1', [pid]);
    const open = opening(p.text), vec = p.v ? JSON.parse(p.v) : null;
    const dup = vec && kept.find(x => x.vec && (() => {
      const c = cosine(vec, x.vec);
      return c >= 0.97 || (c >= 0.75 && open && open === x.open);
    })());
    if (dup) { dup.similar.push(pid); continue; }
    kept.push({ pid, open, vec, similar: [] });
  } else kept.push({ pid, similar: [] });
  byParent.set(pid, h);
  if (byParent.size >= k) break;
}
const similarOf = new Map(kept.map(x => [x.pid, x.similar]));

const results = [];
for (const [pid, hit] of byParent) {
  const { rows: [parent] } = await pool.query(
    'SELECT doc_path, byte_start, byte_end, content_sha256, text FROM chunks WHERE id=$1', [pid]);
  let ctx = { start: parent.byte_start, end: parent.byte_end, text: parent.text };
  if (mode !== 'parent' && hit.kind === 'sentence') {
    const { rows: sibs } = await pool.query(
      'SELECT byte_start, byte_end FROM chunks WHERE parent_id=$1 ORDER BY byte_start', [pid]);
    const i = sibs.findIndex(s => Number(s.byte_start) === Number(hit.byte_start));
    const lo = mode === 'window' ? sibs[Math.max(0, i - 1)] : sibs[i];
    const hi = mode === 'window' ? sibs[Math.min(sibs.length - 1, i + 1)] : sibs[i];
    const pbuf = Buffer.from(parent.text, 'utf8');
    const s = Number(lo.byte_start), e = Number(hi.byte_end);
    ctx = { start: s, end: e, text: pbuf.subarray(s - parent.byte_start, e - parent.byte_start).toString('utf8') };
  }
  results.push({
    source: `${parent.doc_path}#bytes=${ctx.start}-${ctx.end}`,
    match: { kind: hit.kind, bytes: [Number(hit.byte_start), Number(hit.byte_end)], dense_rank: hit.dense_rank, lexical_rank: hit.lexical_rank },
    parent_sha256: parent.content_sha256,
    score: Number(hit.score).toFixed(4),
    similar: await Promise.all((similarOf.get(pid) ?? []).map(async (id) => {
      const { rows: [r] } = await pool.query('SELECT doc_path, byte_start, byte_end FROM chunks WHERE id=$1', [id]);
      return `${r.doc_path}#bytes=${r.byte_start}-${r.byte_end}`;
    })),
    text: ctx.text,
    verified: root ? (() => {
      try { return readFileSync(join(root, parent.doc_path)).subarray(ctx.start, ctx.end).equals(Buffer.from(ctx.text, 'utf8')); }
      catch { return false; }
    })() : undefined,
  });
}

if (asJson) console.log(JSON.stringify(results, null, 2));
else for (const r of results) {
  console.log(`\n${r.verified === undefined ? '▸' : r.verified ? '✓' : '✗ STALE'} ${r.source}  (match ${r.match.kind} ${r.match.bytes.join('-')}, dense #${r.match.dense_rank ?? '-'}, lexical #${r.match.lexical_rank ?? '-'})`);
  console.log('  ' + r.text.replace(/\s+/g, ' ').slice(0, 400));
  if (r.similar.length) console.log(`  (+${r.similar.length} near-duplicate${r.similar.length > 1 ? 's' : ''}: ${r.similar.slice(0, 3).join(', ')}${r.similar.length > 3 ? ', …' : ''})`);
}
await pool.end();
