#!/usr/bin/env node

// Generates an HTML compliance audit report from stela JSON output.
//
// Usage:
//   npx @watthem/stela corpus/*.txt --json | node tools/audit-report.mjs > report.html
//   node tools/audit-report.mjs stela-output.json > report.html
//   node tools/audit-report.mjs --multi file1.json file2.json > report.html

import { readFileSync } from "node:fs";
import { basename } from "node:path";

const args = process.argv.slice(2);
const multi = args.includes("--multi");
const files = args.filter((a) => a !== "--multi");

let chunks;
if (files.length > 0) {
  const raw = files.map((f) => readFileSync(f, "utf8")).join("\n");
  chunks = parseChunks(raw);
} else {
  const stdin = readFileSync(0, "utf8");
  chunks = parseChunks(stdin);
}

function parseChunks(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    return JSON.parse(trimmed);
  }
  return trimmed
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

const byFile = new Map();
for (const chunk of chunks) {
  const file = chunk.source?.file || "unknown";
  if (!byFile.has(file)) byFile.set(file, []);
  byFile.get(file).push(chunk);
}

const totalChunks = chunks.length;
const verified = chunks.filter(
  (c) => c.assessment?.confidence?.hashVerified === true
).length;
const passed = chunks.filter((c) => c.assessment?.verdict === "pass").length;
const flagged = chunks.filter((c) => c.assessment?.verdict === "flag").length;
const rejected = chunks.filter(
  (c) => c.assessment?.verdict === "reject"
).length;
const skipped = chunks.filter(
  (c) => c.assessment?.verdict === "skipped"
).length;

const verificationRate =
  totalChunks > 0 ? ((verified / totalChunks) * 100).toFixed(1) : "0.0";
const passRate =
  totalChunks > 0 ? ((passed / totalChunks) * 100).toFixed(1) : "0.0";

const now = new Date().toISOString().split("T")[0];

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>stela Provenance Audit Report</title>
<style>
  :root {
    --bg: #0a0a0a;
    --surface: #111111;
    --border: #2c2b28;
    --text: #e8e6e1;
    --text-dim: #8a8880;
    --amber: #F5A623;
    --green: #5CB85C;
    --red: #E06060;
    --blue: #5B9BD5;
  }
  @media print {
    :root { --bg: #fff; --surface: #f8f8f8; --border: #ddd; --text: #111; --text-dim: #666; }
    body { font-size: 11pt; }
    .no-print { display: none; }
    .page-break { page-break-before: always; }
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Space Grotesk', Inter, system-ui, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.6;
    padding: 40px;
    max-width: 900px;
    margin: 0 auto;
  }
  h1 { font-size: 28px; font-weight: 600; margin-bottom: 4px; }
  h2 { font-size: 20px; font-weight: 600; margin: 32px 0 16px; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
  h3 { font-size: 16px; font-weight: 600; margin: 24px 0 8px; }
  .subtitle { color: var(--text-dim); font-size: 14px; margin-bottom: 32px; }
  .header-bar {
    display: flex; justify-content: space-between; align-items: baseline;
    border-bottom: 2px solid var(--amber); padding-bottom: 16px; margin-bottom: 32px;
  }
  .header-bar .logo { color: var(--amber); font-family: 'Space Mono', monospace; font-size: 12px; letter-spacing: 2px; }
  .summary-grid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 16px; margin-bottom: 32px;
  }
  .stat-card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 6px; padding: 16px;
  }
  .stat-card .value { font-size: 32px; font-weight: 600; font-family: 'Space Mono', monospace; }
  .stat-card .label { font-size: 12px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
  .stat-card.green .value { color: var(--green); }
  .stat-card.amber .value { color: var(--amber); }
  .stat-card.red .value { color: var(--red); }
  table { width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 24px; }
  th { text-align: left; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-dim); padding: 8px 12px; border-bottom: 1px solid var(--border); }
  td { padding: 8px 12px; border-bottom: 1px solid var(--border); font-family: 'Space Mono', monospace; font-size: 13px; }
  tr:hover td { background: var(--surface); }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
  .badge-pass { background: #122014; color: var(--green); border: 1px solid var(--green); }
  .badge-flag { background: #251b0d; color: var(--amber); border: 1px solid var(--amber); }
  .badge-reject { background: #241313; color: var(--red); border: 1px solid var(--red); }
  .badge-skip { background: var(--surface); color: var(--text-dim); border: 1px solid var(--border); }
  .badge-verified { background: #122014; color: var(--green); border: 1px solid var(--green); }
  .finding { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 16px; margin-bottom: 12px; }
  .finding.issue { border-left: 3px solid var(--red); }
  .finding.warning { border-left: 3px solid var(--amber); }
  .chunk-text { font-family: 'Space Mono', monospace; font-size: 12px; color: var(--text-dim); white-space: pre-wrap; word-break: break-all; max-height: 60px; overflow: hidden; }
  .meta { font-size: 12px; color: var(--text-dim); }
  .disclaimer { font-size: 12px; color: var(--text-dim); margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--border); }
</style>
</head>
<body>
<div class="header-bar">
  <div>
    <h1>Provenance Audit Report</h1>
    <div class="subtitle">Generated ${now} by stela v0.2.1</div>
  </div>
  <div class="logo">STELA / PROVENANCE</div>
</div>

<h2>Summary</h2>
<div class="summary-grid">
  <div class="stat-card green">
    <div class="value">${verificationRate}%</div>
    <div class="label">Hash verified</div>
  </div>
  <div class="stat-card ${passed === totalChunks ? "green" : "amber"}">
    <div class="value">${passRate}%</div>
    <div class="label">Quality pass</div>
  </div>
  <div class="stat-card">
    <div class="value">${totalChunks}</div>
    <div class="label">Total chunks</div>
  </div>
  <div class="stat-card">
    <div class="value">${byFile.size}</div>
    <div class="label">Source files</div>
  </div>
</div>

<table>
  <tr><th>Metric</th><th>Count</th><th>Rate</th></tr>
  <tr><td>Hash verified</td><td>${verified}</td><td>${verificationRate}%</td></tr>
  <tr><td>Quality: pass</td><td>${passed}</td><td>${totalChunks > 0 ? ((passed / totalChunks) * 100).toFixed(1) : "0.0"}%</td></tr>
  <tr><td>Quality: flag</td><td>${flagged}</td><td>${totalChunks > 0 ? ((flagged / totalChunks) * 100).toFixed(1) : "0.0"}%</td></tr>
  <tr><td>Quality: reject</td><td>${rejected}</td><td>${totalChunks > 0 ? ((rejected / totalChunks) * 100).toFixed(1) : "0.0"}%</td></tr>
  <tr><td>Quality: skipped</td><td>${skipped}</td><td>${totalChunks > 0 ? ((skipped / totalChunks) * 100).toFixed(1) : "0.0"}%</td></tr>
</table>

<h2>Per-document breakdown</h2>
${[...byFile.entries()]
  .map(([file, fileChunks]) => {
    const fVerified = fileChunks.filter(
      (c) => c.assessment?.confidence?.hashVerified === true
    ).length;
    const fPassed = fileChunks.filter(
      (c) => c.assessment?.verdict === "pass"
    ).length;
    const fFlagged = fileChunks.filter(
      (c) => c.assessment?.verdict === "flag"
    ).length;
    const fRejected = fileChunks.filter(
      (c) => c.assessment?.verdict === "reject"
    ).length;
    const byteStart = Math.min(...fileChunks.map((c) => c.source?.byteStart ?? 0));
    const byteEnd = Math.max(...fileChunks.map((c) => c.source?.byteEnd ?? 0));
    return `
<h3>${escapeHtml(basename(file))}</h3>
<p class="meta">Source: ${escapeHtml(file)} | Byte range: [${byteStart}, ${byteEnd}) | Chunks: ${fileChunks.length}</p>
<table>
  <tr><th>#</th><th>Byte range</th><th>Hash</th><th>Verdict</th><th>Preview</th></tr>
  ${fileChunks
    .map(
      (c) => `<tr>
    <td>${c.index ?? ""}</td>
    <td>[${c.source?.byteStart ?? "?"}, ${c.source?.byteEnd ?? "?"})</td>
    <td>${c.assessment?.confidence?.hashVerified ? '<span class="badge badge-verified">verified</span>' : '<span class="badge badge-reject">failed</span>'}</td>
    <td>${verdictBadge(c.assessment?.verdict)}</td>
    <td><div class="chunk-text">${escapeHtml((c.text || "").slice(0, 80))}${(c.text || "").length > 80 ? "..." : ""}</div></td>
  </tr>`
    )
    .join("\n  ")}
</table>
${fFlagged > 0 || fRejected > 0 ? `<div class="finding ${fRejected > 0 ? "issue" : "warning"}"><strong>${fFlagged + fRejected} chunk${fFlagged + fRejected > 1 ? "s" : ""} require attention</strong> (${fFlagged} flagged, ${fRejected} rejected). Review boundary quality and completeness for these chunks before using them in production.</div>` : ""}`;
  })
  .join("\n")}

<h2>What this report covers</h2>
<p>This report verifies that each chunk produced by stela can be independently traced back to exact bytes in the source document. For every chunk:</p>
<ul style="margin: 12px 0 12px 24px;">
  <li>The byte range <code>[byteStart, byteEnd)</code> was sliced from the source</li>
  <li>The SHA-256 hash of that slice was compared to the stored <code>contentHash</code></li>
  <li>Boundary quality heuristics were applied (unless validation was skipped)</li>
</ul>
<p>A "verified" chunk means its byte range and hash matched the source at audit time. It does not prove factual accuracy, authorship, or that the source has not changed since chunking.</p>

<div class="disclaimer">
  <p><strong>Disclaimer:</strong> This report reflects the state of the source documents at the time of audit. stela verifies byte-level provenance, not semantic accuracy or legal compliance. Consult qualified counsel for regulatory compliance determinations. Generated by <a href="https://www.npmjs.com/package/@watthem/stela" style="color: var(--amber);">@watthem/stela</a>.</p>
</div>
</body>
</html>`;

process.stdout.write(html);

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function verdictBadge(verdict) {
  switch (verdict) {
    case "pass":
      return '<span class="badge badge-pass">pass</span>';
    case "flag":
      return '<span class="badge badge-flag">flag</span>';
    case "reject":
      return '<span class="badge badge-reject">reject</span>';
    case "skipped":
      return '<span class="badge badge-skip">skipped</span>';
    default:
      return '<span class="badge badge-skip">unknown</span>';
  }
}
