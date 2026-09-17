import { readFileSync } from "node:fs";
import { run } from "../src/pipeline.js";

const lines = readFileSync("bench/data/sec-2024.ndjson", "utf-8").split("\n").filter((l) => l);
const doc = JSON.parse(lines[0]);
const result = run(doc.text, { strategy: "paragraph", file: "test.txt" });

const reasons: Record<string, number> = {};
let flagged = 0;
for (const c of result.chunks) {
  if (c.assessment.verdict === "flag") {
    flagged++;
    for (const r of c.assessment.reasons) {
      reasons[r] = (reasons[r] || 0) + 1;
    }
  }
}
console.log("Flagged:", flagged, "of", result.chunks.length);
console.log("Reasons:", JSON.stringify(reasons, null, 2));

const flaggedChunks = result.chunks.filter((c) => c.assessment.verdict === "flag");
for (const c of flaggedChunks.slice(0, 8)) {
  const text = c.text.slice(0, 120).replace(/\n/g, "\\n");
  console.log(
    `\nFlagged [${c.assessment.reasons}] conf=${c.assessment.confidence.score.toFixed(3)}: ${text}`
  );
}
