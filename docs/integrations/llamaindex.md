# Add byte-verifiable provenance to a LlamaIndex pipeline

LlamaIndex and stela handle different parts of a RAG pipeline. LlamaIndex provides loaders, retrievers, indexes, and query engines. stela provides exact UTF-8 byte ranges and a SHA-256 hash that is verified before each chunk is emitted.

This guide shows how to use stela as a LlamaIndex.TS node parser so every `TextNode` in your index carries provenance metadata.

It is based on the checked-in [integration experiment](../experiments/llamaindex-integration/results.md), run on 2026-09-22 with `llamaindex` 0.12.1 and `@watthem/stela` 0.2.1. The experiment's `npm start` runs the wrapper below through `IngestionPipeline`, `VectorStoreIndex`, retrieval, and post-edit verification, and asserts each result.

## The wrapper

Drop this into your project. It extends LlamaIndex's `NodeParser`, so it works anywhere LlamaIndex accepts a node parser or transformation, including `IngestionPipeline`.

```ts
// stela-node-parser.ts
import { readFileSync } from "node:fs";
import { NodeParser, NodeRelationship, TextNode } from "llamaindex";
import { run } from "@watthem/stela";

type StelaStrategy = "paragraph" | "heading" | "sentence" | "word";

interface StelaNodeParserOptions {
  strategy?: StelaStrategy;
  maxWords?: number;
  validate?: boolean;
}

export class StelaNodeParser extends NodeParser<TextNode[]> {
  private strategy: StelaStrategy;
  private maxWords?: number;
  private validate: boolean;

  constructor(options: StelaNodeParserOptions = {}) {
    super();
    this.strategy = options.strategy ?? "paragraph";
    this.maxWords = options.maxWords;
    this.validate = options.validate ?? true;
    // Document metadata is merged below, before stela's fields, so a
    // document-level `source` key cannot overwrite the chunk provenance.
    this.includeMetadata = false;
  }

  protected parseNodes(documents: TextNode[]): TextNode[] {
    const nodes: TextNode[] = [];

    for (const doc of documents) {
      const filePath = doc.metadata?.file_path;
      const input = filePath ? readFileSync(filePath) : doc.text;

      const result = run(input, {
        file: filePath ?? doc.metadata?.source ?? doc.id_,
        strategy: this.strategy,
        maxWords: this.maxWords,
        validate: this.validate,
      });

      for (const chunk of result.chunks) {
        nodes.push(
          new TextNode({
            text: chunk.text,
            metadata: {
              ...doc.metadata,
              source: chunk.source.file,
              byteStart: chunk.source.byteStart,
              byteEnd: chunk.source.byteEnd,
              contentHash: chunk.source.contentHash,
              hashVerified: chunk.assessment.confidence.hashVerified,
              qualityVerdict: chunk.assessment.verdict,
              strategy: chunk.source.strategy,
              ...(chunk.source.heading && {
                heading: chunk.source.heading,
                headingLevel: chunk.source.headingLevel,
              }),
            },
            relationships: {
              [NodeRelationship.SOURCE]: doc.asRelatedNodeInfo(),
            },
          }),
        );
      }
    }

    return nodes;
  }
}
```

Install both packages:

```bash
npm install llamaindex @watthem/stela
```

When `file_path` is present in the document metadata, the parser reads the file as a `Buffer`, so byte ranges refer to the actual file bytes. Without `file_path`, it uses the document text, and byte ranges refer to its UTF-8 encoding.

Document metadata is copied onto each node, then stela's fields are written over it. A loader-supplied `source` key cannot replace the chunk's provenance.

## Use it in an ingestion pipeline

```ts
import { readFileSync } from "node:fs";
import { Document, IngestionPipeline, VectorStoreIndex } from "llamaindex";
import { StelaNodeParser } from "./stela-node-parser.js";

const pipeline = new IngestionPipeline({
  transformations: [new StelaNodeParser({ strategy: "heading" })],
});

const documents = [
  new Document({
    text: readFileSync("contract.md", "utf8"),
    metadata: { file_path: "contract.md" },
  }),
];

const nodes = await pipeline.run({ documents });
const index = await VectorStoreIndex.init({ nodes });
```

Pass the nodes to `VectorStoreIndex.init`. `VectorStoreIndex.fromDocuments` re-parses documents with `Settings.nodeParser`, and in `llamaindex` 0.12.1 assigning `Settings.nodeParser` from the `llamaindex` entry point does not reach `fromDocuments`: it silently falls back to `SentenceSplitter` and the nodes lose stela metadata. See [Finding 5](../experiments/llamaindex-integration/results.md#finding-5-settingsnodeparser-is-not-honored-by-vectorstoreindexfromdocuments-in-llamaindex-0121).

You can also call the parser directly:

```ts
const nodes = new StelaNodeParser({ strategy: "paragraph" }).getNodesFromDocuments(documents);
```

## Verify after retrieval

After retrieving nodes from the index, verify that the source hasn't changed:

```ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { MetadataMode, type NodeWithScore } from "llamaindex";

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
```

A `false` result means the bytes at the recorded range changed since indexing. An edit that changes the file's length also shifts every later range, so later chunks from the same file fail too even if their text is unchanged. Re-chunk and re-index the whole file when any of its chunks fails.

## Heading strategy for legal documents

The heading strategy recognizes both Markdown ATX headings and common legal section headings (ARTICLE, Section, Exhibit, Schedule, RECITALS, PREAMBLE, WHEREAS) outside fenced code blocks. Each node's metadata includes `heading` and `headingLevel` when a heading was recognized.

```ts
const parser = new StelaNodeParser({ strategy: "heading" });
const nodes = parser.getNodesFromDocuments(documents);

for (const node of nodes) {
  if (node.metadata.heading) {
    console.log(`Section: ${node.metadata.heading} (level ${node.metadata.headingLevel})`);
  }
}
```

## Limits

- stela accepts UTF-8 text only. Use a LlamaIndex loader (`PDFReader`, `DocxReader`, etc.) to extract text first, then chunk the extracted text with stela. The byte ranges will refer to the extracted text artifact, not the original PDF/DOCX.
- stela's `word` strategy counts whitespace-delimited words, not model tokens. For hard token budgets, use LlamaIndex's `SentenceSplitter` with a `chunkSize` instead.
- The wrapper reads files synchronously. For large-scale ingestion, consider batching documents.
- Tested only with LlamaIndex's in-memory vector store. Check that your vector store preserves numeric `byteStart`/`byteEnd` metadata before relying on it.
- Node IDs are UUIDs generated per run. They are not stable across re-indexing.
