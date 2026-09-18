#!/usr/bin/env python3
"""Chunk a document with LangChain's RecursiveCharacterTextSplitter and report start_index."""

import json
import sys
from pathlib import Path
from langchain_text_splitters import RecursiveCharacterTextSplitter

doc_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("test-document.txt")
text = doc_path.read_text(encoding="utf-8")

splitter = RecursiveCharacterTextSplitter(
    chunk_size=300,
    chunk_overlap=0,
    add_start_index=True,
    separators=["\n\n", "\n", " ", ""],
)

docs = splitter.create_documents([text])

chunks = []
for i, doc in enumerate(docs):
    start = doc.metadata["start_index"]
    chunk_text = doc.page_content

    # Verify: does slicing at start_index recover this chunk?
    slice_at_index = text[start : start + len(chunk_text)]
    offset_correct = slice_at_index == chunk_text

    # Check how many times this exact chunk text appears in the source
    occurrences = []
    pos = -1
    while True:
        pos = text.find(chunk_text, pos + 1)
        if pos == -1:
            break
        occurrences.append(pos)

    chunks.append({
        "index": i,
        "text": chunk_text,
        "start_index": start,
        "length": len(chunk_text),
        "offset_correct": offset_correct,
        "occurrences_in_source": occurrences,
        "is_duplicate_text": len(occurrences) > 1,
        "find_returns_first": occurrences[0] if occurrences else None,
    })

output = {"tool": "langchain", "total_chunks": len(chunks), "chunks": chunks}
out_path = Path("langchain-output.json")
out_path.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"Wrote {len(chunks)} chunks to {out_path}")

wrong = [c for c in chunks if not c["offset_correct"]]
dupes = [c for c in chunks if c["is_duplicate_text"]]
print(f"Correct offsets: {len(chunks) - len(wrong)}/{len(chunks)}")
print(f"Duplicate text chunks: {len(dupes)}")
if wrong:
    print(f"\nWRONG offsets ({len(wrong)}):")
    for c in wrong:
        print(f"  chunk {c['index']}: start_index={c['start_index']}, "
              f"find()={c['find_returns_first']}, "
              f"occurrences={c['occurrences_in_source']}")
        print(f"    text: {c['text'][:80]}...")
if dupes:
    print(f"\nDUPLICATE TEXT chunks ({len(dupes)}):")
    for c in dupes:
        print(f"  chunk {c['index']}: start_index={c['start_index']}, "
              f"find()={c['find_returns_first']}, "
              f"occurrences={c['occurrences_in_source']}")
        print(f"    text: {c['text'][:80]}...")
        if c['start_index'] == c['find_returns_first'] and len(c['occurrences_in_source']) > 1:
            actual_pos = [p for p in c['occurrences_in_source'] if p != c['start_index']]
            if c['occurrences_in_source'].index(c['start_index']) > 0:
                print(f"    *** MISATTRIBUTED: points to first occurrence, not this one ***")
