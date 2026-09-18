# LangChain vs stela: comparison experiment

Ran 2026-09-17. Evidence-gathering for the integrations spec.

## Setup

- LangChain: `langchain-text-splitters` 1.1.2, `RecursiveCharacterTextSplitter` with `add_start_index=True`
- stela: `@watthem/stela` 0.1.1, `--strategy paragraph --json`
- Two test documents: one with duplicate paragraphs (English), one with accented characters (French)

## Finding 1: character offsets vs byte offsets (Unicode)

LangChain's `start_index` is a character offset into the Python string. stela's `byteStart`/`byteEnd` are byte offsets into the UTF-8 file.

For ASCII-only text, these are the same. For text with multi-byte characters (accented letters, CJK, emoji), they diverge.

Test document: a French technical spec (546 chars, 578 bytes).

```
LangChain chunk 0: char_offset=   0  (byte_equiv=   0, delta=+0)   file slice: CORRECT
LangChain chunk 1: char_offset= 236  (byte_equiv= 249, delta=+13)  file slice: WRONG
LangChain chunk 2: char_offset= 418  (byte_equiv= 442, delta=+24)  file slice: WRONG

stela chunk 0: byte_range=[0, 27)     file slice: CORRECT  hash_verified: true
stela chunk 1: byte_range=[29, 40)    file slice: CORRECT  hash_verified: true
stela chunk 2: byte_range=[42, 218)   file slice: CORRECT  hash_verified: true
stela chunk 3: byte_range=[220, 247)  file slice: CORRECT  hash_verified: true
stela chunk 4: byte_range=[249, 425)  file slice: CORRECT  hash_verified: true
stela chunk 5: byte_range=[427, 440)  file slice: CORRECT  hash_verified: true
stela chunk 6: byte_range=[442, 577)  file slice: CORRECT  hash_verified: true
```

If you store LangChain's `start_index` and later try to slice the original file at that position, you get the wrong bytes for any chunk after the first multi-byte character. The error accumulates — by chunk 2, you're off by 24 bytes.

stela's byte offsets work directly against the file. You can `file.slice(byteStart, byteEnd)` and get the chunk content back, verified by SHA-256.

## Finding 2: duplicate text handling

Test document: a Terms of Service with three copies of the same paragraph and two copies of a liability disclaimer.

LangChain uses `text.find(chunk, offset)` to locate each chunk. It searches forward from the previous chunk's position, so it usually finds the right occurrence in sequential documents. In this test, all 15 LangChain chunks had correct character offsets.

However, LangChain's approach has known failure cases:
- GitHub issue #21475: `find()` returns 0 for chunks with duplicate substrings when overlap interacts badly with the search offset
- GitHub issue #29884: `TokenTextSplitter` produces -1 offsets because token counts and character counts don't align
- The forward-search heuristic depends on chunks being produced in document order, which isn't guaranteed for all splitter configurations

stela tracks byte offsets during the split, not after. For the duplicate paragraphs, stela produced correct and distinct byte ranges for each occurrence:

```
chunk  7: byteStart=  589 byteEnd=  816  hash=4d41fc90...  (first copy)
chunk  8: byteStart=  818 byteEnd= 1045  hash=4d41fc90...  (second copy)
chunk 24: byteStart= 3105 byteEnd= 3332  hash=4d41fc90...  (third copy)
```

Same hash (same content), different byte ranges (different locations in the file). Each independently verifiable.

## Finding 3: what stela adds that LangChain doesn't

| Feature | LangChain | stela |
|---|---|---|
| Offset type | Character (Python string index) | Byte (UTF-8 file offset) |
| Verification | None — `start_index` is best-effort | SHA-256 hash checked before emitting |
| Failure mode | Silent wrong offset | Throws on verification failure |
| Duplicate text | Usually correct (forward search), known failure cases | Always correct (tracked during split) |
| File-level provenance | Character offset requires byte conversion | Byte range slices the file directly |

## Honest limitations

- LangChain's forward-search approach works correctly for most sequential documents. The duplicate-text bug requires specific conditions (overlapping chunks, non-sequential splitting, or token-based splitters).
- stela currently only supports UTF-8 text input. LangChain's ecosystem handles PDFs, HTML, and other formats via document loaders. stela requires text extraction first.
- stela splits by paragraph/heading/sentence/word. LangChain's `RecursiveCharacterTextSplitter` is more configurable (custom separators, arbitrary chunk sizes).
- stela is Node.js/TypeScript only. LangChain is Python-first with a JS port.

## Commands used

```bash
# LangChain
pip install langchain-text-splitters
python3 langchain_chunk.py test-document.txt
python3 langchain_chunk.py test-unicode.txt  # (inline script)

# stela
npx @watthem/stela test-document.txt --strategy paragraph --json > stela-output.json
npx @watthem/stela test-unicode.txt --strategy paragraph --json > stela-unicode-output.json
```

## Files in this directory

- `test-document.txt` — English ToS with duplicate paragraphs
- `test-unicode.txt` — French technical spec with accented characters
- `langchain_chunk.py` — LangChain chunking script
- `langchain-output.json` — LangChain output (English doc)
- `stela-output.json` — stela output (English doc)
- `stela-unicode-output.json` — stela output (French doc)
- `results.md` — this file
