# Agent rules for stela

These constraints apply to every agent (Claude, Codex, Astra, or any other) working in this repository.

## Self-verification

stela is a provenance tool. Agents working on it must eat their own dogfood.

- Before writing a claim about stela's output, run stela and confirm the claim.
- Before writing a claim about another tool's behavior, reproduce it with a pinned version and capture the output under `docs/experiments/`.
- If a claim cannot be verified in the current environment (no GPU, no API access, no cloud account), say so explicitly and mark the claim as untested. Do not publish it as fact.
- If a previously published claim is found to be wrong, fix the document and note the correction in the commit message.

## Evidence hierarchy

1. Captured tool output in `docs/experiments/` (strongest)
2. Linked external issue or commit with quoted text
3. External documentation with URL and access date
4. "Not yet tested" (acceptable when labeled)
5. Unsourced assertion (not acceptable)

## Documentation

- `docs/spec.md` is the living spec. Update it when the implementation changes.
- `docs/docs-spec.md` defines tone, audience, and structure for public docs.
- Integration guides require a reproducible experiment before they get written. No experiment, no guide.
- Blog posts go through the humanizer skill before shipping.

## Handoff protocol

When stopping mid-work, commit with a message that starts with `WIP:` and includes:
- What was completed
- What is next
- Any blockers

This lets the next agent (or the same agent in a new session) pick up without re-deriving context.

## Code

- All 15 tests must pass before committing changes to `src/`.
- Zero runtime dependencies is a hard constraint.
- Node.js >= 22.
- Don't normalize line endings or Unicode in chunks. Chunks are verbatim slices.
- If a provenance verification fails, throw. Never emit a chunk with bad provenance.
