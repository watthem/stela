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
