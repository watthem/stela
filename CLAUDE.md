# stela

Document preprocessing CLI with byte-range provenance. `@watthem/stela` on npm.

## Quick orientation

- `src/` — TypeScript source. `pipeline.ts` is the entry point; `chunk.ts` has splitting logic.
- `docs/` — public documentation, experiments, and blog posts.
- `docs/spec.md` — living spec. Update it when the implementation changes.
- `docs/experiments/` — reproducible benchmarks. Each has its own README.
- Zero runtime dependencies. Node.js >= 22. MIT licensed. All 18 tests must pass before merging.

## Self-verification rule

stela's value proposition is provenance. Every claim we publish about stela must be backed by reproducible evidence in this repository.

Before publishing or committing any document (blog post, docs page, comparison, integration guide) that makes a factual claim about stela's behavior or another tool's behavior:

1. **Run stela on the example.** If the claim says "stela produces X," run it and confirm.
2. **Run the other tool too.** If the claim says "tool Y does Z," reproduce it. Cite the version tested and link the captured output or the experiment directory.
3. **Link the evidence.** Every factual claim must point to a file in `docs/experiments/` or to a specific external issue/commit. "We found" without a link is not acceptable.
4. **State honest limitations.** If a failure case didn't reproduce, say so. If a comparison is unfair (different granularity, different input format), say so.
5. **Don't extrapolate.** A local FAISS test is not a Pinecone cloud test. A 15-contract subset is not the full CUAD dataset. Say what was actually tested.

This applies to all agents working in this repo, not just humans.

## Docs and blog tone

Technical, direct, no marketing language. Show what the tool does by running it. Let the reader decide if they need it. See `docs/docs-spec.md` for full guidance.

Run the humanizer skill on blog posts before they ship.

## Commit and push

Commit to main. Push after committing. This is a solo repo with Codex auto-review enabled — no PR workflow unless the change is large enough to warrant one.

## What not to do

- Don't claim stela proves factual accuracy. It proves byte-range integrity.
- Don't use "revolutionary," "game-changing," or marketing adjectives.
- Don't publish a guide for an integration that hasn't been tested with a reproducible experiment.
- Don't treat character offsets as byte offsets in examples or comparisons. This is the exact mistake stela exists to prevent.
