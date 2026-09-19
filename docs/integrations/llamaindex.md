# Add byte-verifiable provenance to a LlamaIndex pipeline

LlamaIndex and stela handle different parts of a RAG pipeline. LlamaIndex provides loaders, retrievers, indexes, and query engines. stela provides exact UTF-8 byte ranges and a SHA-256 hash that is verified before each chunk is emitted.

This guide shows how to use stela as a LlamaIndex.TS node parser so every `TextNode` in your index carries provenance metadata.

## The wrapper

Drop this into your project. It implements the node parser interface that `IngestionPipeline` and `Settings.nodeParser` expect.

```ts
// stela-node-parser.ts
import { readFileSync } from "node:fs";
import { Document, TextNode, MetadataMode } from "llamaindex";
import { run } from "@watthem/stela";

type StelaStrategy = "paragraph" | "heading" | "sentence" | "word";

interface StelaNodeParserOptions {
  strategy?: StelaStrategy;
  maxWords?: number;
  validate?: boolean;
}

export class StelaNodeParser {
  private strategy: StelaStrategy;
  private maxWords?: number;
  private validate: boolean;

  constructor(options: StelaNodeParserOptions = {}) {
    this.strategy = options.strategy ?? "paragraph";
    this.maxWords = options.maxWords;
    this.validate = options.validate ?? true;
  }

  getNodesFromDocuments(documents: Document[]): TextNode[] {
    const nodes: TextNode[] = [];

    for (const doc of documents) {
      const filePath = doc.metadata?.file_path || doc.metadata?.source || doc.id_;
      const input = doc.metadata?.file_path
        ? readFileSync(doc.metadata.file_path)
        : doc.getText();

      const result = run(input, {
        file: filePath,
        strategy: this.strategy,
        maxWords: this.maxWords,
        validate: this.validate,
      });

      for (const chunk of result.chunks) {
        const node = new TextNode({
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
          },
        });

        nodes.push(node);
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

## Use it as the default node parser

```ts
import { Settings } from "llamaindex";
import { StelaNodeParser } from "./stela-node-parser.js";

Settings.nodeParser = new StelaNodeParser({ strategy: "paragraph" });
```

Every index built after this assignment uses stela for splitting. Each node's metadata includes `byteStart`, `byteEnd`, and `contentHash`.

## Use it in an ingestion pipeline

```ts
import { Document, IngestionPipeline, VectorStoreIndex } from "llamaindex";
import { StelaNodeParser } from "./stela-node-parser.js";

const pipeline = new IngestionPipeline({
  transformations: [
    new StelaNodeParser({ strategy: "heading" }),
  ],
});

const documents = [
  new Document({
    text: readFileSync("contract.md", "utf8"),
    metadata: { file_path: "contract.md" },
  }),
];

const nodes = await pipeline.run({ documents });
const index = await VectorStoreIndex.fromDocuments([], { nodes });
```

When `file_path` is present in the document metadata, the parser reads the file as a `Buffer` so byte ranges refer to the actual file bytes. Without `file_path`, it uses the document text and byte ranges refer to its UTF-8 encoding.

## Verify after retrieval

After retrieving nodes from the index, verify that the source hasn't changed:

```ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { NodeWithScore } from "llamaindex";

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

A `false` result means the source document changed at the recorded range since indexing. Re-chunk and re-index the affected file.

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
- Node IDs are UUIDs generated per run. They are not stable across re-indexing.
