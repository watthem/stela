import { readFileSync } from "node:fs";
import { run } from "../src/pipeline.js";
import type { Strategy, PipelineResult } from "../src/types.js";

interface DatasetResult {
  name: string;
  totalDocs: number;
  totalSizeMB: number;
  strategies: Record<
    string,
    {
      chunks: number;
      passed: number;
      flagged: number;
      rejected: number;
      meanConfidence: number;
      totalMs: number;
      mbPerSec: number;
      provenanceFailures: number;
    }
  >;
}

function verifyProvenance(source: string, result: PipelineResult): number {
  const buf = Buffer.from(source);
  let failures = 0;
  for (const chunk of result.chunks) {
    const slice = buf.subarray(chunk.source.byteStart, chunk.source.byteEnd).toString();
    if (slice !== chunk.text) {
      failures++;
      if (failures <= 3) {
        console.error(
          `  PROVENANCE FAIL chunk ${chunk.index}: expected ${JSON.stringify(chunk.text.slice(0, 50))}... got ${JSON.stringify(slice.slice(0, 50))}...`
        );
      }
    }
  }
  return failures;
}

function processDataset(
  name: string,
  docs: string[],
  fileNames: string[],
  strategies: Strategy[]
): DatasetResult {
  const totalSize = docs.reduce((s, d) => s + Buffer.byteLength(d), 0);
  const totalSizeMB = totalSize / 1024 / 1024;

  const result: DatasetResult = {
    name,
    totalDocs: docs.length,
    totalSizeMB,
    strategies: {},
  };

  for (const strategy of strategies) {
    let totalChunks = 0;
    let totalPassed = 0;
    let totalFlagged = 0;
    let totalRejected = 0;
    let totalConfidence = 0;
    let totalMs = 0;
    let totalProvFailures = 0;

    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      if (!doc || doc.trim().length === 0) continue;

      const r = run(doc, {
        strategy,
        file: fileNames[i] || `doc-${i}`,
      });

      totalChunks += r.stats.totalChunks;
      totalPassed += r.stats.passed;
      totalFlagged += r.stats.flagged;
      totalRejected += r.stats.rejected;
      totalConfidence += (r.stats.meanConfidence ?? 0) * r.stats.totalChunks;
      totalMs += r.stats.processingMs;

      totalProvFailures += verifyProvenance(doc, r);
    }

    const mbPerSec = totalSizeMB / (totalMs / 1000);

    result.strategies[strategy] = {
      chunks: totalChunks,
      passed: totalPassed,
      flagged: totalFlagged,
      rejected: totalRejected,
      meanConfidence: totalChunks > 0 ? totalConfidence / totalChunks : 0,
      totalMs,
      mbPerSec,
      provenanceFailures: totalProvFailures,
    };
  }

  return result;
}

function printResult(r: DatasetResult) {
  console.log(`\n## ${r.name}`);
  console.log(`Documents: ${r.totalDocs} | Total size: ${r.totalSizeMB.toFixed(1)} MB\n`);
  console.log(
    "Strategy     | Chunks   | Pass%  | Flag%  | Rej%   | Confidence | Time     | MB/s   | Prov Fails"
  );
  console.log(
    "-------------|----------|--------|--------|--------|------------|----------|--------|----------"
  );
  for (const [strategy, s] of Object.entries(r.strategies)) {
    const passP = ((s.passed / s.chunks) * 100).toFixed(1);
    const flagP = ((s.flagged / s.chunks) * 100).toFixed(1);
    const rejP = ((s.rejected / s.chunks) * 100).toFixed(1);
    const time =
      s.totalMs > 1000 ? `${(s.totalMs / 1000).toFixed(1)}s` : `${s.totalMs.toFixed(0)}ms`;
    console.log(
      `${strategy.padEnd(13)}| ${String(s.chunks).padEnd(9)}| ${passP.padEnd(7)}| ${flagP.padEnd(7)}| ${rejP.padEnd(7)}| ${s.meanConfidence.toFixed(4).padEnd(11)}| ${time.padStart(8)} | ${s.mbPerSec.toFixed(1).padStart(6)} | ${s.provenanceFailures}`
    );
  }
}

// --- Load datasets ---

const args = process.argv.slice(2);
const datasetArg = args[0] || "all";
const sampleSize = parseInt(args[1] || "1000", 10);

const strategies: Strategy[] = ["heading", "paragraph", "sentence", "token"];

// We expect pre-extracted NDJSON files in bench/data/
// Use the Python extractor to convert parquet -> ndjson first

async function loadNdjson(path: string, limit: number): Promise<{ texts: string[]; names: string[] }> {
  const content = readFileSync(path, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  const texts: string[] = [];
  const names: string[] = [];
  for (let i = 0; i < Math.min(lines.length, limit); i++) {
    const obj = JSON.parse(lines[i]);
    texts.push(obj.text || "");
    names.push(obj.title || obj.filename || obj.id || `doc-${i}`);
  }
  return { texts, names };
}

async function main() {
  const results: DatasetResult[] = [];

  if (datasetArg === "all" || datasetArg === "wikipedia") {
    console.log(`Loading Wikipedia (first ${sampleSize} articles)...`);
    try {
      const { texts, names } = await loadNdjson(
        "bench/data/wikipedia-100k.ndjson",
        sampleSize
      );
      console.log(`Loaded ${texts.length} articles, processing...`);
      const r = processDataset("Wikipedia-100k", texts, names, strategies);
      results.push(r);
      printResult(r);
    } catch (e) {
      console.error(`Wikipedia load failed: ${e}. Run: python3 bench/extract-datasets.py`);
    }
  }

  if (datasetArg === "all" || datasetArg === "sec") {
    console.log(`\nLoading SEC filings (first ${sampleSize})...`);
    try {
      const { texts, names } = await loadNdjson("bench/data/sec-2024.ndjson", sampleSize);
      console.log(`Loaded ${texts.length} filings, processing...`);
      const r = processDataset("SEC 10-K Filings (2024)", texts, names, strategies);
      results.push(r);
      printResult(r);
    } catch (e) {
      console.error(`SEC load failed: ${e}. Run: python3 bench/extract-datasets.py`);
    }
  }

  // Summary
  if (results.length > 0) {
    console.log("\n\n## Summary — Paragraph Strategy (primary benchmark)");
    console.log("Dataset              | MB/s   | Prov Fails | Pass%  | Mean Conf");
    console.log("---------------------|--------|------------|--------|----------");
    for (const r of results) {
      const p = r.strategies["paragraph"];
      if (p) {
        const passP = ((p.passed / p.chunks) * 100).toFixed(1);
        console.log(
          `${r.name.padEnd(21)}| ${p.mbPerSec.toFixed(1).padStart(6)} | ${String(p.provenanceFailures).padStart(10)} | ${passP.padEnd(7)}| ${p.meanConfidence.toFixed(4)}`
        );
      }
    }

    // Memory stats
    const mem = process.memoryUsage();
    console.log(`\nMemory usage: RSS=${(mem.rss / 1024 / 1024).toFixed(0)} MB, Heap=${(mem.heapUsed / 1024 / 1024).toFixed(0)} MB`);
  }
}

main().catch(console.error);

