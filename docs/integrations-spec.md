# Integrations spec

Spec for proving and documenting how stela complements other tools in a RAG pipeline. Each integration starts as an experiment — run the tools together, capture real output, measure what you get vs. what you'd get without stela. The guide gets written from the evidence, not before it.

## Process

For each integration:

1. **Build a working example** — real code, real documents, real output
2. **Capture evidence** — output diffs, metrics, failure cases that stela prevents or the partner tool prevents
3. **Write the guide from the evidence** — show the output, explain what happened, link to the code

No guide gets published without a working example behind it. If the integration doesn't produce a meaningful difference, say so honestly and don't publish.

## Candidates

Ranked by audience size and readiness.

### 1. stela + LangChain

**Status:** Ready to build now
**What to prove:** LangChain's `start_index` breaks on duplicate substrings and token splitters. stela's byte ranges don't. Run both on the same document, show the output side by side.
**Experiment:**
- Take a document with repeated paragraphs or boilerplate (legal docs, terms of service)
- Chunk with LangChain's RecursiveCharacterTextSplitter (add_start_index=True)
- Chunk with stela (paragraph strategy)
- Compare: which chunks have correct source locations? Which can be verified?
- Show a case where LangChain returns start_index 0 for multiple chunks and stela returns distinct, verifiable byte ranges
**Deliverable:** Blog post + code example. This is the "why stela exists" story with receipts.

### 2. stela + Jev (TypeSafe AI)

**Status:** Blocked on Jev API access (Matthew signing up)
**What to prove:** stela provides provenance, Jev provides precision filtering. Together: retrieve chunks with verified source ranges, filter irrelevant ones with Jev, pass only high-confidence chunks to the LLM, and trace the answer back to exact source bytes.
**Experiment:**
- Chunk a multi-section document with stela
- Embed and store chunks (with provenance metadata) in a vector store
- Query, retrieve top-k chunks
- Run retrieved chunks through Jev for relevance scoring
- Show: the chunks Jev keeps still carry verified byte ranges back to the source
- Show: the chunks Jev drops were irrelevant AND you can prove what they contained
**Deliverable:** Blog post + code example. Timing is good — Jev just launched Sep 15.

### 3. stela + vector stores (Pinecone / Weaviate / Qdrant)

**Status:** Ready to build now
**What to prove:** Provenance metadata survives the embed-store-retrieve cycle. You can query a vector store, get a chunk back, and trace it to the exact bytes in the source document.
**Experiment:**
- Chunk a document with stela
- Store chunks + provenance metadata in a vector store
- Query and retrieve
- Verify: does the byte range still match? Does the hash still check out?
- Show the verification round-trip end to end
**Deliverable:** Short tutorial. Less of a story, more of a recipe.

### 4. stela + LlamaIndex

**Status:** Ready to build, lower priority than LangChain
**What to prove:** Similar to LangChain — LlamaIndex's node metadata can carry stela provenance, and stela's byte ranges are more reliable than LlamaIndex's built-in source tracking.
**Experiment:** Same shape as the LangChain experiment but with LlamaIndex's node/document model.
**Deliverable:** Blog post or tutorial, depending on how interesting the comparison turns out.

### 5. stela + CI/compliance pipelines

**Status:** Conceptual — needs a real use case to anchor it
**What to prove:** stela's provenance output can feed a compliance audit trail. When a regulator asks "where did that AI answer come from?" you can produce a chain: answer → chunk → verified byte range → source document → version.
**Experiment:** Build a minimal pipeline that chunks, stores provenance in a database, answers a question, and produces an audit report tracing the answer back to source bytes.
**Deliverable:** Blog post targeting regulated-industry engineers. Hold until there's a real customer conversation to ground it.

## What each experiment must capture

- The exact commands or code used (reproducible)
- Raw output from both tools (stela and the partner)
- At least one failure case the integration prevents
- At least one honest limitation or rough edge
- Performance: how much time/cost does adding stela to the pipeline add?

## Design notes

- Each guide should work standalone — don't assume the reader has read other guides
- Code examples in TypeScript (stela's native language), with notes for Python consumers where relevant
- Run the humanizer on every guide before publishing
- Link back to the provenance contract page for the trust anchor
