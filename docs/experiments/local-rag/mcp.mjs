#!/usr/bin/env node
// Minimal MCP server (stdio, JSON-RPC, no SDK) over the local index.
//   claude mcp add stela-rag -e DATABASE_URL=... -e STELA_ROOT=/path/to/indexed/dir -- node /path/to/mcp.mjs
// Tools:
//   search   hybrid retrieval via query.mjs; every hit is a verified byte range (✓/✗ against STELA_ROOT)
//   related  files nearest to a given file (mean of its paragraph embeddings), for "what else covers this?"
//   read     re-read an exact `path#bytes=s-e` citation from disk, optionally widened by N bytes
//   trace    follow citations: what a passage rests on (recursively) and what cites it
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { pool } from './db.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = process.env.STELA_ROOT;
const run = promisify(execFile);

const tools = [
  { name: 'search', description: 'Search the indexed notes by meaning and keywords. Returns exact, verified source citations (path#bytes=start-end) with their text. Near-duplicates are folded into `similar`.',
    inputSchema: { type: 'object', required: ['query'], properties: {
      query: { type: 'string' },
      k: { type: 'integer', default: 8 },
      return: { type: 'string', enum: ['sentence', 'window', 'parent'], default: 'parent' },
      prior: { type: 'string', description: "Optional path weights, e.g. 'glossary/**=0.5,journal/**=0.8'" } } } },
  { name: 'related', description: 'Files whose content is nearest to the given file (mean paragraph embedding). Use to find overlapping, duplicate or contradicting notes.',
    inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string', description: 'Indexed path relative to the root' }, k: { type: 'integer', default: 10 } } } },
  { name: 'trace', description: 'Follow byte-range citations from a note or passage: what it rests on (recursively, each source re-checked on disk: ok/changed/unpinned/out_of_range/missing) and which passages cite it.',
    inputSchema: { type: 'object', required: ['target'], properties: { target: { type: 'string', description: 'path.md or path.md#bytes=s-e' }, depth: { type: 'integer', default: 3 } } } },
  { name: 'read', description: 'Read an exact citation (path#bytes=start-end) from disk, optionally widened by `context` bytes each side.',
    inputSchema: { type: 'object', required: ['source'], properties: { source: { type: 'string' }, context: { type: 'integer', default: 0 } } } },
];

async function search({ query, k = 8, return: mode = 'parent', prior }) {
  const a = [join(here, 'query.mjs'), query, '--k', String(k), '--return', mode, '--json'];
  if (root) a.push('--root', root);
  if (prior) a.push('--prior', prior);
  const { stdout } = await run('node', a, { maxBuffer: 64 << 20, env: process.env });
  return JSON.parse(stdout).map(r => ({ source: r.source, verified: r.verified, score: r.score, similar: r.similar, text: r.text }));
}

async function related({ path, k = 10 }) {
  const { rows } = await pool.query(`
    WITH v AS (SELECT avg(embedding::vector) AS m FROM chunks WHERE doc_path = $1 AND kind = 'parent' AND embedding IS NOT NULL),
    near AS (SELECT c.doc_path, c.byte_start, c.byte_end, c.embedding <=> (SELECT m FROM v)::halfvec AS d
             FROM chunks c WHERE c.kind = 'parent' AND c.embedding IS NOT NULL AND c.doc_path <> $1
             ORDER BY c.embedding <=> (SELECT m FROM v)::halfvec LIMIT 200)
    SELECT DISTINCT ON (doc_path) doc_path, byte_start, byte_end, d FROM near ORDER BY doc_path, d`, [path]);
  if (!rows.length) throw new Error(`no embedded paragraphs for ${path}`);
  return rows.sort((a, b) => a.d - b.d).slice(0, k)
    .map(r => ({ path: r.doc_path, nearest: `${r.doc_path}#bytes=${r.byte_start}-${r.byte_end}`, similarity: +(1 - r.d).toFixed(3) }));
}

function read({ source, context = 0 }) {
  if (!root) throw new Error('STELA_ROOT is not set');
  const m = /^(.*)#bytes=(\d+)-(\d+)$/.exec(source);
  if (!m) throw new Error('expected path#bytes=start-end');
  const file = resolve(root, m[1]);
  if (!file.startsWith(resolve(root) + '/')) throw new Error('path escapes STELA_ROOT');
  const buf = readFileSync(file);
  const s = Math.max(0, Number(m[2]) - context), e = Math.min(buf.length, Number(m[3]) + context);
  return { source: `${m[1]}#bytes=${s}-${e}`, text: buf.subarray(s, e).toString('utf8') };
}

async function trace({ target, depth = 3 }) {
  const a = [join(here, 'trace.mjs'), target, '--depth', String(depth), '--json'];
  if (root) a.push('--root', root);
  const { stdout } = await run('node', a, { maxBuffer: 64 << 20, env: process.env });
  return JSON.parse(stdout);
}

const handlers = { search, related, read, trace };
const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');

for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;
  let req;
  try { req = JSON.parse(line); } catch { continue; }
  const { id, method, params } = req;
  if (id === undefined) continue; // notifications (initialized, cancelled)
  try {
    if (method === 'initialize') send({ id, result: { protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'stela-rag', version: '0.1.0' } } });
    else if (method === 'tools/list') send({ id, result: { tools } });
    else if (method === 'tools/call') {
      const fn = handlers[params?.name];
      if (!fn) { send({ id, error: { code: -32602, message: `unknown tool ${params?.name}` } }); continue; }
      try { send({ id, result: { content: [{ type: 'text', text: JSON.stringify(await fn(params.arguments ?? {}), null, 2) }] } }); }
      catch (err) { send({ id, result: { isError: true, content: [{ type: 'text', text: String(err.message ?? err) }] } }); }
    } else if (method === 'ping') send({ id, result: {} });
    else send({ id, error: { code: -32601, message: `method not found: ${method}` } });
  } catch (err) { send({ id, error: { code: -32603, message: String(err.message ?? err) } }); }
}
await pool.end();
