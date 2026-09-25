#!/usr/bin/env node
// Walk byte-range citations (path.md#bytes=s-e[&sha256=hex]) through the index.
//   node trace.mjs <path.md | path.md#bytes=s-e> [--depth 3] [--root <indexed-dir>] [--json]
// back:  what the passage cites, recursively (its sources, their sources, ...)
// forward: which indexed passages cite anything inside this range
// With --root, every cited range is re-read from disk: ok / changed (pinned hash differs) /
// unpinned / out_of_range / missing. Citations come from the `cites` view (schema.sql).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pool } from './db.mjs';

const args = process.argv.slice(2);
const target = args.find((a, i) => !a.startsWith('--') && !['--depth', '--root'].includes(args[i - 1]));
if (!target) { console.error('usage: trace.mjs <path.md[#bytes=s-e]> [--depth 3] [--root dir] [--json]'); process.exit(2); }
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const depth = Number(opt('--depth', 3));
const root = opt('--root');

const parse = (s) => {
  const m = /^(.+?\.md)(?:#bytes=(\d+)-(\d+))?(?:&sha256=([0-9a-f]+))?$/.exec(s);
  if (!m) throw new Error(`not a citation: ${s}`);
  return { path: m[1], start: m[2] ? Number(m[2]) : 0, end: m[3] ? Number(m[3]) : Number.MAX_SAFE_INTEGER, sha: m[4] };
};
const fmt = (c) => c.end === Number.MAX_SAFE_INTEGER ? c.path : `${c.path}#bytes=${c.start}-${c.end}${c.sha ? `&sha256=${c.sha}` : ''}`;

function check(c) {
  if (!root || c.end === Number.MAX_SAFE_INTEGER) return undefined;
  if (c.path.startsWith('/') || c.path.split('/').includes('..')) return 'invalid';
  let buf;
  try { buf = readFileSync(join(root, c.path)); } catch { return 'missing'; }
  if (c.end > buf.length) return 'out_of_range';
  if (!c.sha) return 'unpinned';
  return createHash('sha256').update(buf.subarray(c.start, c.end)).digest('hex').startsWith(c.sha) ? 'ok' : 'changed';
}

// Citations made by indexed passages that overlap c.
async function citedBy(c) {
  const { rows } = await pool.query(`
    SELECT DISTINCT x.to_path, x.to_start, x.to_end, x.to_sha256
    FROM cites x JOIN chunks p ON p.id = x.from_id
    WHERE p.doc_path = $1 AND p.byte_start < $3 AND p.byte_end > $2`, [c.path, c.start, c.end]);
  return rows.map(r => ({ path: r.to_path, start: Number(r.to_start), end: Number(r.to_end), sha: r.to_sha256 ?? undefined }));
}

async function back(c, d, seen) {
  const key = fmt(c);
  const node = { cite: key, status: check(c), sources: [] };
  if (d === 0 || seen.has(key)) return node;
  seen.add(key);
  for (const s of await citedBy(c)) node.sources.push(await back(s, d - 1, seen));
  return node;
}

const t = parse(target);
const tree = await back(t, depth, new Set());
const { rows: fwd } = await pool.query(`
  SELECT x.from_path, p.byte_start, p.byte_end, x.to_start, x.to_end
  FROM cites x JOIN chunks p ON p.id = x.from_id
  WHERE x.to_path = $1 AND x.to_start < $3 AND x.to_end > $2 ORDER BY x.from_path`, [t.path, t.start, t.end]);
const forward = fwd.map(r => ({ by: `${r.from_path}#bytes=${r.byte_start}-${r.byte_end}`, cites: `${t.path}#bytes=${r.to_start}-${r.to_end}` }));

if (args.includes('--json')) console.log(JSON.stringify({ back: tree, forward }, null, 2));
else {
  const show = (n, ind) => { console.log(`${ind}${n.status ? `[${n.status}] ` : ''}${n.cite}`); for (const s of n.sources) show(s, ind + '  ← '); };
  console.log('back (what this rests on):'); show(tree, '  ');
  console.log(`forward (cited by ${forward.length}):`); for (const f of forward) console.log(`  ${f.by}  →  ${f.cites}`);
}
await pool.end();
