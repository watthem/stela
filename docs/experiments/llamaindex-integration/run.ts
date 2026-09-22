// Reproduces every claim in docs/integrations/llamaindex.md against pinned
// llamaindex and @watthem/stela versions. Output is captured in output.txt.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import {
  BaseEmbedding,
  Document,
  IngestionPipeline,
  MetadataMode,
  Settings,
  VectorStoreIndex,
  type NodeWithScore,
} from "llamaindex";
import { StelaNodeParser } from "./stela-node-parser.ts";

// Deterministic local embedding so the experiment needs no API key.
class LengthEmbedding extends BaseEmbedding {
  async getTextEmbedding(text: string) {
    return [text.length % 7, text.includes("Payment") ? 1 : 0, 1];
  }
}
Settings.embedModel = new LengthEmbedding();

function verifyNode(nodeWithScore: NodeWithScore): boolean {
  const meta = nodeWithScore.node.metadata;
  if (!meta.source || meta.byteStart == null || meta.byteEnd == null) {
    return false;
  }
  const sourceBytes = readFileSync(meta.source);
  const slice = sourceBytes.subarray(meta.byteStart, meta.byteEnd);
  const hash = createHash("sha256").update(slice).digest("hex");
  return (
    slice.equals(Buffer.from(nodeWithScore.node.getContent(MetadataMode.NONE), "utf8")) &&
    hash === meta.contentHash
  );
}

const WORK = "work-copy.md";
copyFileSync("contract.md", WORK);
const documents = () => [
  new Document({
    text: readFileSync(WORK, "utf8"),
    // A loader-supplied `source` must not overwrite stela's provenance.
    metadata: { file_path: WORK, source: "loader-label" },
  }),
];

// 1. IngestionPipeline + VectorStoreIndex.init
const pipeline = new IngestionPipeline({
  transformations: [new StelaNodeParser({ strategy: "heading" })],
});
const nodes = await pipeline.run({ documents: documents() });
console.log(`1. pipeline: ${nodes.length} nodes`);
for (const node of nodes) {
  const m = node.metadata;
  const bytes = readFileSync(WORK).subarray(m.byteStart, m.byteEnd);
  assert.equal(m.source, WORK);
  assert.equal(bytes.toString("utf8"), node.getContent(MetadataMode.NONE));
  console.log(`   [${m.byteStart}, ${m.byteEnd}) heading=${JSON.stringify(m.heading)} level=${m.headingLevel} hashVerified=${m.hashVerified}`);
}

const index = await VectorStoreIndex.init({ nodes });
const retrieved = await index.asRetriever({ similarityTopK: nodes.length }).retrieve({ query: "Payment" });
const before = retrieved.map(verifyNode);
console.log(`2. retrieved ${retrieved.length}, verifyNode: ${JSON.stringify(before)}`);
assert.ok(before.every(Boolean));

// 3. Edit the source after indexing. A same-length edit fails only its own
// range; a length-changing edit also shifts every later range.
const failedAfter = (from: string, to: string) => {
  copyFileSync("contract.md", WORK);
  writeFileSync(WORK, readFileSync(WORK, "utf8").replace(from, to));
  return retrieved
    .filter((r) => !verifyNode(r))
    .map((r) => r.node.metadata.heading as string)
    .sort();
};
const sameLength = failedAfter("thirty days", "ninety days");
const shorter = failedAfter("thirty days", "sixty days");
console.log(`3a. same-length edit in Section 2, failed: ${JSON.stringify(sameLength)}`);
console.log(`3b. shorter edit in Section 2, failed: ${JSON.stringify(shorter)}`);
assert.deepEqual(sameLength, ["Section 2. Payment"]);
assert.deepEqual(shorter, ["Section 2. Payment", "Section 3. Termination"]);

// 4. Text-only document (no file_path): ranges refer to the UTF-8 encoding.
copyFileSync("contract.md", WORK);
const [first] = new StelaNodeParser({ strategy: "paragraph" }).getNodesFromDocuments([
  new Document({ text: "Café\n\nSecond" }),
]);
console.log(`4. text-only: [${first.metadata.byteStart}, ${first.metadata.byteEnd}) for "Café"`);
assert.equal(first.metadata.byteEnd, 5);

// 5. Settings.nodeParser + VectorStoreIndex.fromDocuments
Settings.nodeParser = new StelaNodeParser({ strategy: "paragraph" });
const viaSettings = await VectorStoreIndex.fromDocuments(documents());
const settingsNodes = await viaSettings.asRetriever({ similarityTopK: 10 }).retrieve({ query: "x" });
const honored = settingsNodes.some((r) => r.node.metadata.byteStart != null);
console.log(`5. Settings.nodeParser honored by fromDocuments: ${honored} (${settingsNodes.length} nodes)`);

rmSync(WORK);
