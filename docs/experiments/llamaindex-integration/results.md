# LlamaIndex.TS + stela: integration experiment

Ran 2026-09-22. Evidence for [the LlamaIndex integration guide](../../integrations/llamaindex.md).

## Setup

- `llamaindex` 0.12.1, `@watthem/stela` 0.2.1, Node.js 24.19.0 (versions pinned in `package.json`)
- Wrapper: [`stela-node-parser.ts`](stela-node-parser.ts), the same code the guide shows
- Fixture: [`contract.md`](contract.md), a short Markdown contract with accented characters
- Embeddings: a deterministic local stub, so no API key is needed. Retrieval ranking is not under test; metadata round-tripping is.

Reproduce:

```bash
cd docs/experiments/llamaindex-integration
npm install
npm start          # asserts every result below; exits non-zero on failure
npm run typecheck
```

Captured output: [`output.txt`](output.txt).

## Finding 1: the first published wrapper did not work in an ingestion pipeline

The guide's original `StelaNodeParser` (commit `1f8948d`) was a plain class with a `getNodesFromDocuments` method. `IngestionPipeline` calls a transformation's `transform` method, so the documented pipeline example failed:

```
TypeError: transform is not a function
```

The original also left `heading`/`headingLevel` out of node metadata even though the guide said they were there. It also used `VectorStoreIndex.fromDocuments([], { nodes })`, which (per the 0.12.1 source) overwrites `nodes` with the parse of the empty document list and builds an empty index, and its `verifyNode` snippet used `MetadataMode` without importing it.

The corrected wrapper extends LlamaIndex's `NodeParser`, which provides `transform` and `getNodesFromDocuments`. It copies heading metadata, links each node to its source document, and indexes with `VectorStoreIndex.init({ nodes })`.

## Finding 2: provenance survives the pipeline, the index, and retrieval

```
1. pipeline: 3 nodes
   [0, 120) heading="Services Agreement" level=1 hashVerified=true
   [122, 188) heading="Section 2. Payment" level=2 hashVerified=true
   [190, 256) heading="Section 3. Termination" level=2 hashVerified=true
2. retrieved 3, verifyNode: [true,true,true]
```

Each node's `[byteStart, byteEnd)` slice of the file equals its text, and the retrieved nodes pass `verifyNode`. The fixture contains multi-byte characters before the first chunk ends, so these are byte offsets, not character offsets.

The document carried a loader-style `source: "loader-label"` in its metadata. The node's `source` is still the file path. LlamaIndex's `NodeParser` merges parent-document metadata over node metadata by default, so the wrapper sets `includeMetadata = false` and merges document metadata itself, *before* the stela fields.

## Finding 3: edits after indexing are detected, and length changes cascade

```
3a. same-length edit in Section 2, failed: ["Section 2. Payment"]
3b. shorter edit in Section 2, failed: ["Section 2. Payment","Section 3. Termination"]
```

A same-length edit ("thirty" → "ninety") fails only the edited chunk. A length-changing edit ("thirty" → "sixty") shifts every later byte, so every later chunk from that file fails too, even though its text did not change. That is expected for byte ranges: re-chunk and re-index the whole file when any chunk fails.

## Finding 4: text-only documents use the UTF-8 encoding

```
4. text-only: [0, 5) for "Café"
```

Without `file_path`, ranges refer to the UTF-8 encoding of `document.text` (`é` is two bytes).

## Finding 5: `Settings.nodeParser` is not honored by `VectorStoreIndex.fromDocuments` in llamaindex 0.12.1

```
5. Settings.nodeParser honored by fromDocuments: false (1 nodes)
```

In this version, `llamaindex/indices` contains its own bundled `Settings` instance. Assigning `Settings.nodeParser` through the `llamaindex` entry point does not reach it, and `fromDocuments` falls back to the default `SentenceSplitter`. The guide therefore passes stela nodes explicitly (`IngestionPipeline` or `getNodesFromDocuments`, then `VectorStoreIndex.init({ nodes })`) instead of relying on the global setting. This is observed behavior of one pinned version, not a documented LlamaIndex contract; recheck on upgrade.

## Not tested

- Persistent vector stores (Pinecone, Qdrant, pgvector, etc.). Metadata round-tripping was checked only with the in-memory `SimpleVectorStore`.
- Real embedding models and retrieval quality.
- LlamaIndex Python.
