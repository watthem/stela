# Illustrations spec

Spec for visual diagrams and illustrations that explain how stela works. These will be produced by Codex or another agent and used in documentation and blog posts.

## Guiding principle

Show, don't explain. Each illustration should make one concept obvious that would take a paragraph to describe in words. The reader should understand what stela does by looking at the pictures before reading any prose.

## Design language

Follow the stela brand from the existing site design:
- Dark background, light text
- Space Grotesk for labels, Space Mono for code/data
- Amber accent (#F59E0B or similar) for highlights and provenance markers
- Minimal, no decorative elements. Every visual element carries information.

## Illustration 1: The chunk map

**Concept:** Show a real document (the README.md), its chunks, and the byte ranges mapping each chunk back to the source.

**Layout:**
- Left side: the full document text, with subtle line numbers or byte-offset rulers along the edge
- Right side: the chunks as separate cards/blocks, each showing: chunk text (truncated if long), byte range `[start, end)`, SHA-256 hash (truncated)
- Connecting lines or highlights: each chunk's byte range highlighted in the source document, with a line or color-match connecting it to the chunk card

**What it should make obvious:** every chunk is a verifiable slice of the original. You can point at any chunk and trace it back to exact bytes in the source.

**Variations:**
- Paragraph strategy: chunks split at blank lines
- Heading strategy: chunks split at `#` headings, showing the heading attached to its section

## Illustration 2: Character vs. byte coordinate systems

**Concept:** A character index and a byte offset diverge for non-ASCII text. Using one as the other points at the wrong bytes.

**Layout, two panels:**

Panel A — "Position found after splitting" (the mismatch):
1. Decoded string with accented characters (French: caractères, données, résumé)
2. `start_index`: 236 characters
3. Same location in UTF-8: byte 249
4. Coordinate drift: +13 bytes
5. `fileBytes.slice(236, …)` → WRONG TEXT
6. Note: the character index is valid for the decoded string; it fails only when reused as a file-byte offset.

Panel B — "Byte position tracked during split" (stela's way):
1. Source bytes with hex (c3 a9, f0 9f)
2. `byteStart: 249`, `byteEnd: 425`, SHA-256 hash
3. `fileBytes.slice(249, 425)` → EXACT TEXT + HASH ✓
4. Note: the file coordinate is known when the boundary is made; stela verifies the slice before returning the chunk.

Footer: `236 CHARACTERS ≠ 249 BYTES`

**What it should make obvious:** multi-byte UTF-8 characters cause character counts and byte counts to drift apart. This is the verified mismatch from the repository's French fixture (546 chars, 578 bytes), not a hypothetical.

## Illustration 3: The verification round-trip

**Concept:** Given a chunk's byte range and hash, you can independently verify it against the source file.

**Layout, circular flow:**
1. Source file (with byte ruler)
2. Arrow: stela splits and records `[byteStart, byteEnd)` + SHA-256
3. Chunk with its provenance metadata
4. Arrow: "Verify" — slice source bytes at `[start, end)`, compute SHA-256
5. Comparison: stored hash === computed hash? checkmark.
6. Arrow back to source: "This chunk is this exact part of the document"

**What it should make obvious:** verification is independent. You don't need stela to verify — anyone with the source file and the byte range can confirm the chunk is authentic.

## Illustration 4: Pipeline stages

**Concept:** The six stages of the stela pipeline, as a horizontal flow.

**Layout:**
```
[Input] → [Validate] → [Decode] → [Split] → [Verify] → [Assess] → [Output]
  UTF-8     reject bad    text +     chunks    byte-slice   heuristic   Chunk[]
  file      encodings     bytes      + offsets  + SHA-256    quality     + stats
```

Each stage as a box with a one-line description. Small icons or indicators for what can fail at each stage (red X for malformed input at Validate, throw at Verify).

**What it should make obvious:** provenance verification (stage 5) happens before output. Bad provenance never ships.

## Illustration 5: Strategy comparison

**Concept:** The same document chunked four ways.

**Layout:** Four columns, same source text at top, different chunk boundaries highlighted below:
- Paragraph: blank-line splits
- Heading: `#` splits
- Sentence: period/punctuation splits
- Word (max 50): fixed word-count splits

Color-code each chunk differently. Show byte ranges for each.

**What it should make obvious:** the strategy controls where you split, not whether provenance works. All four produce verified chunks.

## Production notes

- Target both light and dark backgrounds (provide both variants, or use the dark background as primary)
- Export as SVG for docs, PNG for blog posts and social media
- Keep text readable at 800px wide (blog column width)
- Accessible: don't rely on color alone. Use labels, patterns, or position to distinguish elements.
- Each illustration should work standalone — no required context from surrounding prose

## Priority order

1. The chunk map (Illustration 1) — this is the hero image, use it everywhere
2. Character vs. byte coordinate systems (Illustration 2) — this is the differentiator, use in the blog and "Why not X?" page
3. Verification round-trip (Illustration 3) — use in the provenance contract page
4. Pipeline stages (Illustration 4) — use in "How it works"
5. Strategy comparison (Illustration 5) — use in CLI reference
