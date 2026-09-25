#!/usr/bin/env node
// Bring the index up to date after edits: chunk → load (incremental) → embed, for each model.
//   node reindex.mjs <root> [--exclude 'glob,glob'] [--models qwen3-embedding:0.6b,embeddinggemma]
// Unchanged files are skipped by hash and cached embeddings are reused, so after a small edit
// only the edited file's new paragraphs are embedded. The first model is embedded fully;
// further models get paragraphs only.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const root = args[0];
if (!root) { console.error("usage: reindex.mjs <root> [--exclude 'glob,glob'] [--models m1,m2]"); process.exit(2); }
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const models = opt('--models', 'qwen3-embedding:0.6b').split(',');
const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'stela-reindex-'));
const run = (script, ...a) => execFileSync('node', [join(here, script), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();

try {
  const out = join(dir, 'chunks.ndjson');
  const exclude = opt('--exclude');
  console.log('chunk', run('chunk.mjs', root, '--out', out, ...(exclude ? ['--exclude', exclude] : [])));
  console.log('load ', run('load.mjs', out));
  // Secondary models are paragraph-only (the model comparison runs at paragraph level).
  for (const [i, m] of models.entries())
    console.log(`embed ${m}`, run('embed.mjs', '--model', m, '--batch', '32', ...(i > 0 ? ['--kind', 'parent'] : [])));
} finally { rmSync(dir, { recursive: true, force: true }); }
