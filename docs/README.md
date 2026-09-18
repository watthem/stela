# stela documentation

stela chunks UTF-8 text and records an exact byte range and SHA-256 hash for every chunk. Start with [How stela works](how-it-works.md), then use the reference pages when you need the exact contract or API shape.

## Guides

- [How stela works](how-it-works.md)
- [The provenance contract](provenance-contract.md)
- [CLI reference](cli-reference.md)
- [Library API](library-api.md)
- [When to use stela instead of another tool](why-stela.md)

## Integrations

- [LangChain: add byte-verifiable provenance](integrations/langchain.md)

## Articles

- [Your RAG chunks are lying about where they came from](blog/your-rag-chunks-are-lying-about-where-they-came-from.md)

Integration guides are published only after a reproducible experiment. The repository also contains a [local FAISS experiment](experiments/pinecone-integration/README.md), but it is not presented as a Pinecone guide because Pinecone cloud was not part of that test.

## Evidence

- [LangChain comparison results](experiments/langchain-comparison/results.md)
- [Vector-store stale-detection results](experiments/pinecone-integration/baseline-results.md)
- [Multi-strategy retrieval results](experiments/pinecone-integration/optimization-results.md)
