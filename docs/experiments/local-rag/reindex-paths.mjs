#!/usr/bin/env node
// Reindex an explicit list of paths against the live index, touching nothing else.
//   node reindex-paths.mjs <root> <path>... | --list file   [--models m1,m2] [--dry-run]
// Paths are relative to <root>. A listed path that exists is re-chunked from its bytes (a
// document whose sha256 is unchanged is skipped, so its chunk ids stay as they were); a listed
// path that no longer exists is removed from the index. Other documents are never read or
// deleted, so untracked files under <root> are never swept in. Uses DATABASE_URL like the rest.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const root = args[0] && !args[0].startsWith('--') ? resolve(args[0]) : null;
const list = opt('--list');
const skip = new Set(['--list', '--models'].flatMap(f => (args.indexOf(f) >= 0 ? [args[args.indexOf(f) + 1]] : [])));
const paths = [...new Set([
  ...args.slice(1).filter(a => !a.startsWith('--') && !skip.has(a)),
  ...(list ? readFileSync(list, 'utf8').split('\n').map(l => l.trim()).filter(Boolean) : []),
])].filter(p => p.endsWith('.md'));
if (!root || !paths.length) { console.error('usage: reindex-paths.mjs <root> <path>... | --list file [--models m1,m2] [--dry-run]'); process.exit(2); }
if (paths.some(p => p.startsWith('/') || p.split('/').includes('..'))) { console.error('paths must be root-relative'); process.exit(2); }

const here = dirname(fileURLToPath(import.meta.url));
const run = (script, ...a) => execFileSync('node', [join(here, script), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
const present = paths.filter(p => existsSync(join(root, p)));
const missing = paths.filter(p => !present.includes(p));
console.log(`paths ${paths.length}: ${present.length} present, ${missing.length} missing (will be removed from the index)`);
if (args.includes('--dry-run')) process.exit(0);

const dir = mkdtempSync(join(tmpdir(), 'stela-paths-'));
try {
  for (const p of present) { mkdirSync(dirname(join(dir, 'src', p)), { recursive: true }); copyFileSync(join(root, p), join(dir, 'src', p)); }
  mkdirSync(join(dir, 'src'), { recursive: true });
  const out = join(dir, 'chunks.ndjson');
  console.log('chunk', run('chunk.mjs', join(dir, 'src'), '--out', out));
  console.log('load ', run('load.mjs', out, '--only', ...(missing.length ? ['--remove', missing.join(',')] : [])));
  const models = (opt('--models', 'qwen3-embedding:0.6b')).split(',');
  for (const [i, m] of models.entries())
    console.log(`embed ${m}`, run('embed.mjs', '--model', m, '--batch', '32', ...(i > 0 ? ['--kind', 'parent'] : [])));
} finally { rmSync(dir, { recursive: true, force: true }); }
