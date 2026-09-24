#!/usr/bin/env node
// Chunk a Markdown tree with stela into parent (paragraph) + child (sentence) records.
//
//   node chunk.mjs <root-dir> [--out chunks.ndjson] [--exclude glob,glob]
//
// Prototypes two proposals from the private wiki before they reach src/:
//   1. parent mapping: sentences are segmented inside each paragraph and carry parentId
//   2. wrap-aware sentences: a lone "\n" inside a paragraph is treated as a space for
//      segmentation only (same byte length), so hard-wrapped prose is not split per line.
//   3. heading attachment: a paragraph that is only a Markdown heading is merged into the next
//      paragraph (one contiguous byte range), so bare headings don't win dense ranks alone.
// Every record's text is still an exact slice of the source bytes and is re-verified here.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { run } from '@watthem/stela';

const args = process.argv.slice(2);
const root = args[0];
if (!root) { console.error('usage: chunk.mjs <root-dir> [--out file] [--exclude glob,...]'); process.exit(2); }
const opt = (name, dflt) => { const i = args.indexOf(name); return i > 0 ? args[i + 1] : dflt; };
const out = opt('--out', 'chunks.ndjson');
const excludes = ['.git/**', '.obsidian/**', 'node_modules/**', ...(opt('--exclude', '') || '').split(',').filter(Boolean)];

const globRe = (g) => new RegExp('^' + g.split('**').map(p => p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')).join('.*') + '$');
const excludeRes = excludes.flatMap(g => [globRe(g), globRe('**/' + g)]);
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const rel = relative(root, p).split(sep).join('/');
    if (excludeRes.some(re => re.test(rel) || re.test(rel + '/'))) continue;
    const st = statSync(p, { throwIfNoEntry: false });
    if (!st) continue;
    if (st.isDirectory()) yield* walk(p);
    else if (st.isFile() && name.endsWith('.md')) yield rel;
  }
}

// Lines that start a block (list item, heading, quote, table, fence) keep their line break.
const BLOCK_START = /^[ \t]*(?:[-*+] |\d+[.)] |#{1,6} |> |\||```|~~~)/;
const HEADING_LINE = /^[ \t]*#{1,6} /;
const HEADING_ONLY = /^[ \t]*#{1,6} [^\n]*\s*$/;

/** Sentence spans (byte offsets relative to the paragraph) with wrap-aware segmentation. */
function sentenceSpans(paraBuf) {
  const text = paraBuf.toString('utf8');
  // Replace a lone LF (or CRLF) that joins two prose lines with spaces of equal UTF-16 length;
  // segmentation runs on the copy, slicing uses the original.
  const lines = text.split(/(\r?\n)/);
  let seg = '';
  for (let i = 0; i < lines.length; i++) {
    const part = lines[i];
    const isBreak = part === '\n' || part === '\r\n';
    const next = lines[i + 1] ?? '';
    // Keep the break at a blank line or after a heading (both occur once headings are attached).
    const prev = lines[i - 1] ?? '';
    const hard = BLOCK_START.test(next) || next === '' || prev === '' || HEADING_LINE.test(prev);
    seg += isBreak && !hard ? ' '.repeat(part.length) : part;
  }
  // Convert UTF-16 offsets to byte offsets incrementally (segments arrive in order), so a
  // multi-megabyte paragraph stays linear instead of re-measuring from 0 for every sentence.
  const spans = [];
  let charPos = 0, bytePos = 0;
  const toByte = (c) => { bytePos += Buffer.byteLength(text.slice(charPos, c), 'utf8'); charPos = c; return bytePos; };
  for (const { segment, index } of segmenter.segment(seg)) {
    const lead = segment.length - segment.trimStart().length;
    const body = segment.trim();
    if (!body) continue;
    const startChar = index + lead;
    const start = toByte(startChar);
    spans.push([start, toByte(startChar + body.length)]);
  }
  return spans;
}

// Obsidian wikilinks leak link targets into lexical/semantic similarity; embed without them.
const embedText = (t) => t
  .replace(/!?\[\[([^\]|#]+)(?:#[^\]|]*)?\|([^\]]+)\]\]/g, '$2')
  .replace(/!?\[\[([^\]|#]+)(?:#[^\]]*)?\]\]/g, (_, name) => name.split('/').pop())
  .replace(/\s+/g, ' ').trim();

const records = [];
let files = 0, parents = 0, children = 0, rejected = 0;
for (const rel of walk(root)) {
  const buf = readFileSync(join(root, rel));
  let result;
  try {
    result = run(buf, { strategy: 'paragraph', file: rel });
  } catch (err) {
    console.error(`skip ${rel}: ${err.message}`);
    continue;
  }
  files++;
  const docSha = sha256(buf);
  // Attach heading-only paragraphs to the next paragraph; trailing headings stay on their own.
  const units = [];
  let pendingStart = null;
  for (const c of result.chunks) {
    const { byteStart, byteEnd, contentHash } = c.source;
    if (HEADING_ONLY.test(c.text)) { pendingStart ??= byteStart; continue; }
    units.push(pendingStart === null
      ? { ps: byteStart, pe: byteEnd, hash: contentHash, verdict: c.assessment.verdict }
      : { ps: pendingStart, pe: byteEnd, hash: null, verdict: c.assessment.verdict });
    pendingStart = null;
  }
  if (pendingStart !== null) {
    const last = result.chunks.at(-1).source;
    units.push({ ps: pendingStart, pe: last.byteEnd, hash: null, verdict: 'pass' });
  }
  for (const { ps, pe, hash, verdict } of units) {
    const paraBuf = buf.subarray(ps, pe);
    const text = paraBuf.toString('utf8');
    const parentId = `p:${docSha.slice(0, 16)}:${ps}-${pe}`;
    if (verdict === 'reject') rejected++;
    records.push({
      id: parentId, kind: 'parent', parent_id: null, doc_path: rel, doc_sha256: docSha,
      byte_start: ps, byte_end: pe, content_sha256: hash ?? sha256(paraBuf), verdict,
      text, embed_text: embedText(text),
    });
    parents++;
    for (const [s, e] of sentenceSpans(paraBuf)) {
      const slice = buf.subarray(ps + s, ps + e);
      const text = slice.toString('utf8');
      if (Buffer.byteLength(text) !== e - s) throw new Error(`byte mismatch in ${rel} @${ps + s}`);
      if (HEADING_ONLY.test(text) && e - s < pe - ps) continue; // headings live in the parent only
      records.push({
        id: `s:${docSha.slice(0, 16)}:${ps + s}-${ps + e}`, kind: 'sentence', parent_id: parentId,
        doc_path: rel, doc_sha256: docSha, byte_start: ps + s, byte_end: ps + e,
        content_sha256: sha256(slice), verdict: null, text, embed_text: embedText(text),
      });
      children++;
    }
  }
}
writeFileSync(out, records.map(r => JSON.stringify(r)).join('\n') + '\n');
console.error(JSON.stringify({ files, parents, sentences: children, rejected_parents: rejected, out }));
