import { readFileSync, existsSync } from "node:fs";
import { run } from "../src/pipeline.js";
import type { Strategy } from "../src/types.js";

const fixture = process.argv[2] || "bench/fixture-5k.md";
if (!existsSync(fixture)) {
  console.error(`Fixture not found: ${fixture}. Run: npx tsx bench/generate-fixture.ts`);
  process.exit(1);
}

const source = readFileSync(fixture, "utf-8");
const sizeKB = Buffer.byteLength(source) / 1024;
const sizeMB = sizeKB / 1024;

const strategies: Strategy[] = ["heading", "paragraph", "sentence", "token"];
const iterations = 5;

console.log(`\nstela benchmark — ${fixture}`);
console.log(`File size: ${sizeKB.toFixed(0)} KB (${sizeMB.toFixed(2)} MB)`);
console.log(`Iterations per strategy: ${iterations}\n`);
console.log("Strategy     | Chunks | Passed | Flagged | Rejected | Confidence | Avg ms  | MB/s");
console.log("-------------|--------|--------|---------|----------|------------|---------|------");

for (const strategy of strategies) {
  const times: number[] = [];
  let lastResult = run(source, { strategy, file: fixture });

  for (let i = 0; i < iterations; i++) {
    const result = run(source, { strategy, file: fixture });
    times.push(result.stats.processingMs);
    lastResult = result;
  }

  const avgMs = times.reduce((a, b) => a + b, 0) / times.length;
  const mbPerSec = sizeMB / (avgMs / 1000);
  const s = lastResult.stats;

  console.log(
    `${strategy.padEnd(13)}| ${String(s.totalChunks).padEnd(7)}| ${String(s.passed).padEnd(7)}| ${String(s.flagged).padEnd(8)}| ${String(s.rejected).padEnd(9)}| ${s.meanConfidence.toFixed(4).padEnd(11)}| ${avgMs.toFixed(1).padStart(7)} | ${mbPerSec.toFixed(1)}`
  );
}

console.log("\n--- Provenance verification ---");
const result = run(source, { strategy: "paragraph", file: fixture });
let verified = 0;
let failed = 0;
for (const chunk of result.chunks) {
  if (chunk.assessment.confidence.hashVerified) verified++;
  else failed++;
}
console.log(`Hash verified: ${verified}/${result.chunks.length} (${failed} failures)`);

const byteRangeOk = result.chunks.every(c => {
  const slice = Buffer.from(source).subarray(c.source.byteStart, c.source.byteEnd).toString();
  return slice === c.text;
});
console.log(`Byte-range round-trip: ${byteRangeOk ? "PASS" : "FAIL"}`);
