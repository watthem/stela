# Agent rules for stela

These constraints apply to every agent (Claude, Codex, Astra, or any other) working in this repository.

## Project boundary and coordination

- This repository is public. Keep it limited to source, tests, reproducible experiments, public documentation, and release assets.
- Private research, GTM planning, customer details, agent memory, scratchpads, and work tracking belong in the configured private companion workspace. Do not copy private material here to make it easier to find.
- The companion workspace's `agent/MEMORY.md` is the shared durable memory and `agent/WORK.md` is the shared `/work` queue for Claude Code and Codex.
- The private Google Sheet is authoritative for GTM tasks, launch metrics, and target companies. Do not mirror its rows into `/work` or this repository.
- Do not use unrelated research repositories as stela workspaces.
- Forage is retired for stela. Do not read or write `.forage/` state; use `/work`.
- Treat the public repo and private wiki as the only stela project workspaces. Publication is an explicit move from the private wiki into this repository after evidence and review.

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

## Privacy check

Before committing, scan the diff for private plans, prospect or customer data, unpublished pricing strategy, credentials, and local-only paths. Move private context to the configured companion workspace; never commit secrets.

## Handoff protocol

Use `/work end` for handoff. If stopping mid-code change, make a recoverable `WIP:` commit only when the current repository workflow authorizes a commit, and record the exact next step in the shared private tracker.

This lets the next agent (or the same agent in a new session) pick up without re-deriving context.

## Code

- The complete test suite must pass before committing changes to `src/`.
- Zero runtime dependencies is a hard constraint.
- Node.js >= 22.
- Don't normalize line endings or Unicode in chunks. Chunks are verbatim slices.
- If a provenance verification fails, throw. Never emit a chunk with bad provenance.
