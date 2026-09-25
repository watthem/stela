#!/usr/bin/env node
// Render Claude Code session transcripts (~/.claude/projects/<cwd-slug>/<session>.jsonl) as
// Markdown that chunk.mjs can index and that citations can point into.
//   node transcripts.mjs --out <dir> [--src ~/.claude/projects] [--projects slug,slug | --skip slug,slug]
// Kept: operator turns ("dispatch" in subagent transcripts), the assistant's visible text, and compaction summaries (dense recaps).
// Dropped: thinking, tool calls and tool results (file dumps, command output), attachments,
// meta and command records. Subagent transcripts (<session>/subagents/*.jsonl) render alongside.
//
// Output is append-only by construction: a session's file is rewritten in full on each run, but
// the frontmatter is fixed and turns only ever get added at the end, so byte ranges cited into
// earlier turns stay valid while a session is still running. Each turn ends with an HTML comment
// naming the record uuid, so a citation can be walked back to the exact JSONL record.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const out = opt('--out');
if (!out) { console.error('usage: transcripts.mjs --out <dir> [--src dir] [--projects a,b | --skip a,b]'); process.exit(2); }
const src = opt('--src', join(homedir(), '.claude', 'projects'));
const only = opt('--projects')?.split(',');
const skip = new Set(opt('--skip', '').split(',').filter(Boolean));

const strip = (s) => s
  .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
  .replace(/<(command-[a-z]+|local-command-[a-z]+|task-notification)>[\s\S]*?<\/\1>/g, '')
  .trim();
const text = (content) => typeof content === 'string' ? content
  : (content ?? []).filter(b => b.type === 'text').map(b => b.text).join('\n\n');
// Headings inside a turn would split it into separate stela sections; demote them.
const body = (s) => s.replace(/^(#{1,6}) /gm, (_, h) => `${'#'.repeat(Math.min(h.length + 2, 6))} `);

function render(file, project) {
  // In a subagent transcript the "user" is the dispatching agent, not the operator.
  const asker = file.includes('/subagents/') ? 'dispatch' : 'operator';
  const recs = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const session = basename(file, '.jsonl');
  const parts = [];
  let n = 0;
  for (const r of recs) {
    if ((r.type !== 'user' && r.type !== 'assistant') || r.isMeta) continue;
    const t = strip(text(r.message?.content));
    if (!t) continue;
    const who = r.isCompactSummary ? 'summary' : r.type === 'user' ? asker : 'assistant';
    if (who === asker && Array.isArray(r.message.content)) continue; // tool results
    if (who === asker) n++;
    const when = (r.timestamp ?? '').slice(0, 16).replace('T', ' ');
    parts.push(`## ${n} · ${who} · ${when}\n\n${body(t)}\n\n<!-- record ${r.uuid} -->\n`);
  }
  if (!parts.length) return null;
  const head = `---\nsession: ${session}\nproject: ${project}\nsource: ${relative(homedir(), file)}\n---\n\n# ${session}\n\n`;
  return { md: head + parts.join('\n') };
}

const files = [];
for (const project of readdirSync(src)) {
  if ((only && !only.includes(project)) || skip.has(project)) continue;
  const dir = join(src, project);
  if (!statSync(dir).isDirectory()) continue;
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.jsonl')) files.push([join(dir, f), project, f.replace(/\.jsonl$/, '.md')]);
    const sub = join(dir, f, 'subagents');
    if (!f.endsWith('.jsonl') && existsSync(sub))
      for (const s of readdirSync(sub)) if (s.endsWith('.jsonl')) files.push([join(sub, s), project, join(f, s.replace(/\.jsonl$/, '.md'))]);
  }
}
let written = 0, empty = 0;
for (const [file, project, rel] of files) {
  const r = render(file, project);
  if (!r) { empty++; continue; }
  const dest = join(out, project, rel);
  mkdirSync(dirname(dest), { recursive: true });
  const prev = existsSync(dest) ? readFileSync(dest, 'utf8') : null;
  if (prev !== null && !r.md.startsWith(prev)) console.error(`not append-only, rewritten: ${relative(out, dest)}`);
  if (prev !== r.md) { writeFileSync(dest, r.md); written++; }
}
console.log(JSON.stringify({ sessions: files.length, written, empty }));
