#!/usr/bin/env python3
"""
Mutation harness for CUAD contracts.

Produces five mutated variants of each contract:
  - CRLF re-export (line ending change)
  - Typo fix (single-word change in one paragraph)
  - Inserted section (new paragraph in the middle)
  - Smart-quote/Unicode change (straight -> curly quotes)
  - Whitespace collapse (multiple spaces -> single)

Usage:
    python scripts/mutate.py data/contracts/ data/mutated/
"""

import os
import sys
import hashlib
import json
import random
import re

random.seed(42)  # Reproducible mutations

INSERTED_PARAGRAPH = (
    "Notwithstanding anything to the contrary herein, the parties acknowledge "
    "and agree that this Section has been inserted for testing purposes only "
    "and shall have no legal or binding effect whatsoever."
)


def read_file(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def write_file(path: str, content: str) -> None:
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(content)


def sha256(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


# --- Mutation functions ---


def mutate_crlf(text: str) -> str:
    """Replace LF line endings with CRLF."""
    # First normalize to LF, then convert to CRLF
    normalized = text.replace("\r\n", "\n")
    return normalized.replace("\n", "\r\n")


def mutate_typo_fix(text: str) -> str:
    """Change one word in one paragraph (simulates a typo fix)."""
    paragraphs = text.split("\n\n")
    # Pick a paragraph with actual content (at least 50 chars)
    candidates = [
        (i, p)
        for i, p in enumerate(paragraphs)
        if len(p.strip()) > 50 and re.search(r"\b\w{4,}\b", p)
    ]
    if not candidates:
        return text  # No suitable paragraph

    idx, para = random.choice(candidates)
    # Find a word to change
    words = list(re.finditer(r"\b(\w{4,})\b", para))
    if not words:
        return text
    target = random.choice(words)
    original_word = target.group(0)
    # Simple mutation: swap two middle characters
    if len(original_word) > 3:
        chars = list(original_word)
        mid = len(chars) // 2
        chars[mid], chars[mid + 1] = chars[mid + 1], chars[mid]
        new_word = "".join(chars)
    else:
        new_word = original_word + "s"

    new_para = para[: target.start()] + new_word + para[target.end() :]
    paragraphs[idx] = new_para
    return "\n\n".join(paragraphs)


def mutate_inserted_section(text: str) -> str:
    """Insert a new paragraph roughly in the middle of the document."""
    paragraphs = text.split("\n\n")
    mid = len(paragraphs) // 2
    paragraphs.insert(mid, INSERTED_PARAGRAPH)
    return "\n\n".join(paragraphs)


def mutate_smart_quotes(text: str) -> str:
    """Replace straight quotes with Unicode curly/smart quotes."""
    result = text
    # Double quotes: opening after space/start, closing before space/end
    result = re.sub(r'(?<=\s)"', "“", result)
    result = re.sub(r'"(?=[\s,.\;\:\)])', "”", result)
    # Single quotes / apostrophes
    result = re.sub(r"(?<=\s)'", "‘", result)
    result = re.sub(r"'(?=[\s,.\;\:\)])", "’", result)
    # Any remaining straight double quotes -> right double
    result = result.replace('"', "”")
    return result


def mutate_whitespace_collapse(text: str) -> str:
    """Collapse runs of multiple spaces to a single space (preserve newlines)."""
    return re.sub(r"[ \t]{2,}", " ", text)


MUTATIONS = {
    "crlf": mutate_crlf,
    "typo": mutate_typo_fix,
    "inserted": mutate_inserted_section,
    "smartquote": mutate_smart_quotes,
    "whitespace": mutate_whitespace_collapse,
}


def main():
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <contracts_dir> <output_dir>")
        sys.exit(1)

    contracts_dir = sys.argv[1]
    output_dir = sys.argv[2]
    os.makedirs(output_dir, exist_ok=True)

    mutation_log = {}

    for filename in sorted(os.listdir(contracts_dir)):
        if not filename.endswith(".txt"):
            continue

        filepath = os.path.join(contracts_dir, filename)
        original = read_file(filepath)
        base = filename.rsplit(".", 1)[0]

        # Copy original
        out_original = os.path.join(output_dir, f"{base}_original.txt")
        write_file(out_original, original)

        file_log = {
            "original_hash": sha256(original),
            "original_length": len(original),
            "mutations": {},
        }

        for mut_name, mut_fn in MUTATIONS.items():
            mutated = mut_fn(original)
            out_path = os.path.join(output_dir, f"{base}_{mut_name}.txt")
            write_file(out_path, mutated)

            file_log["mutations"][mut_name] = {
                "hash": sha256(mutated),
                "length": len(mutated),
                "changed": mutated != original,
            }

        mutation_log[filename] = file_log
        print(f"  {filename}: 5 mutations generated")

    # Save mutation log
    log_path = os.path.join(output_dir, "..", "mutation_log.json")
    with open(log_path, "w") as f:
        json.dump(mutation_log, f, indent=2)

    print(f"\nDone. {len(mutation_log)} contracts x 5 mutations = {len(mutation_log)*5} files")
    print(f"Mutation log: {log_path}")


if __name__ == "__main__":
    main()
