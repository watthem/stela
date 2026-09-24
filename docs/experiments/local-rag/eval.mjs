#!/usr/bin/env node
// Score return modes against a labeled query set at an equal token budget.
//   node eval.mjs <queries.jsonl> [--budget 1500,500] [--k 20] [--json out.json] [--modes parent,window] [--query-args '--prior glossary/**=0.5']
//
// Each line of the set: {"id","query","gold":[{"path","phrase"}]}. `phrase` is a verbatim
// passage that answers the query. A result answers a query when its returned text contains
// the phrase (whitespace-normalized) — from any file, so a copy of the fact elsewhere counts.
// Labels are phrases, not byte ranges, so they survive re-chunking.
//
// For every mode (sentence / window / parent) with near-duplicate collapse on and off:
//   answered@B  the phrase appears in the first B tokens of context, packed in rank order
//               (the last result is cut at the budget)
//   MRR         1 / rank of the first result containing the phrase (0 if none in top k)
//   doc@5       a gold file is among the first 5 result sources (match-level)
//   tokens      mean tokens actually supplied (≤ B)
// Tokens are approximated as chars/4; stela is zero-dependency and no tokenizer is bundled.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const set = args[0];
if (!set) { console.error('usage: eval.mjs <queries.jsonl> [--budget 1500,500] [--k 20] [--json out.json]'); process.exit(2); }
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const budgets = opt('--budget', '1500,500').split(',').map(Number);
const k = Number(opt('--k', 20));
const out = opt('--json');
const modes = opt('--modes', 'sentence,window,parent').split(',');
const extra = (opt('--query-args', '') || '').split(' ').filter(Boolean);
const here = dirname(fileURLToPath(import.meta.url));

const norm = (t) => t.replace(/\s+/g, ' ').trim();
const tokens = (t) => Math.ceil(t.length / 4);
const queries = readFileSync(set, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

function retrieve(query, mode, collapse) {
  const a = [join(here, 'query.mjs'), query, '--k', String(k), '--return', mode, '--json'];
  if (!collapse) a.push('--no-collapse');
  a.push(...extra);
  return JSON.parse(execFileSync('node', a, { encoding: 'utf8', maxBuffer: 64 << 20 }));
}

const configs = [];
for (const mode of modes) for (const collapse of [true, false]) configs.push({ mode, collapse });

const rows = [];
for (const q of queries) {
  const phrases = q.gold.map(g => norm(g.phrase));
  const paths = new Set(q.gold.map(g => g.path));
  for (const c of configs) {
    const res = retrieve(q.query, c.mode, c.collapse);
    const has = (t) => { const n = norm(t); return phrases.some(p => n.includes(p)); };
    const firstHit = res.findIndex(r => has(r.text));
    const row = { id: q.id, area: q.area, ...c, rr: firstHit >= 0 ? 1 / (firstHit + 1) : 0,
      doc5: res.slice(0, 5).some(r => paths.has(r.source.split('#')[0])) };
    for (const B of budgets) {
      let used = 0, packed = '';
      for (const r of res) {
        if (used >= B) break;
        const take = r.text.slice(0, (B - used) * 4);
        packed += '\n' + take; used += tokens(take);
      }
      row[`ans@${B}`] = has(packed);
      row[`tok@${B}`] = used;
    }
    rows.push(row);
  }
  process.stderr.write('.');
}
process.stderr.write('\n');

const mean = (xs) => xs.reduce((s, x) => s + Number(x), 0) / (xs.length || 1);
const summary = configs.map(c => {
  const r = rows.filter(x => x.mode === c.mode && x.collapse === c.collapse);
  const s = { mode: c.mode, collapse: c.collapse, n: r.length, MRR: +mean(r.map(x => x.rr)).toFixed(3),
    'doc@5': +mean(r.map(x => x.doc5)).toFixed(3) };
  for (const B of budgets) { s[`ans@${B}`] = +mean(r.map(x => x[`ans@${B}`])).toFixed(3); s[`tok@${B}`] = Math.round(mean(r.map(x => x[`tok@${B}`]))); }
  return s;
});
console.table(summary);
if (out) writeFileSync(out, JSON.stringify({ set, k, budgets, summary, rows }, null, 2) + '\n');
