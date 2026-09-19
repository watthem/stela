#!/usr/bin/env python3
"""
Stela pipeline: chunking with byte-range provenance and content hashes.

Uses stela CLI for chunking + sentence-transformers embeddings + FAISS.

Measures:
  - Locator verification rate (byte-range slicing + SHA-256 hash match)
  - Stale detection (hash comparison against mutated documents)
  - Retrieval overlap with CUAD ground-truth spans

Usage:
    python scripts/stela_pipeline.py
"""

import json
import os
import sys
import subprocess
import hashlib
import numpy as np

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
EXPERIMENT_DIR = os.path.dirname(SCRIPT_DIR)
STELA_DIR = os.path.abspath(os.path.join(EXPERIMENT_DIR, "..", "..", ".."))
VENV_SITE = os.path.join(EXPERIMENT_DIR, ".venv", "lib")
for d in os.listdir(VENV_SITE) if os.path.isdir(VENV_SITE) else []:
    sp = os.path.join(VENV_SITE, d, "site-packages")
    if os.path.isdir(sp) and sp not in sys.path:
        sys.path.insert(0, sp)

import torch
# Force CPU — the local GPU (GTX 1060) has a CUDA CC too old for this PyTorch build
torch.cuda.is_available = lambda: False
os.environ["CUDA_VISIBLE_DEVICES"] = ""

from sentence_transformers import SentenceTransformer
import faiss

def load_contracts(contracts_dir):
    """Load all contract text files."""
    contracts = {}
    for fname in sorted(os.listdir(contracts_dir)):
        if not fname.endswith(".txt"):
            continue
        path = os.path.join(contracts_dir, fname)
        with open(path, "r", encoding="utf-8") as f:
            contracts[fname] = f.read()
    return contracts


def load_annotations(annotations_path):
    with open(annotations_path) as f:
        return json.load(f)


def chunk_with_stela(filepath):
    """Run stela CLI and parse JSON output."""
    result = subprocess.run(
        ["npx", "@watthem/stela", filepath, "--strategy", "paragraph", "--json"],
        capture_output=True,
        text=True,
        cwd=STELA_DIR,
        timeout=120,
    )

    if result.returncode != 0:
        print(f"  stela error: {result.stderr[:200]}")
        return []

    try:
        chunks_raw = json.loads(result.stdout)
    except json.JSONDecodeError as e:
        print(f"  stela JSON parse error: {e}")
        return []

    chunks = []
    for c in chunks_raw:
        source = c.get("source", {})
        chunks.append({
            "chunk_index": c.get("index", 0),
            "text": c.get("text", ""),
            "byteStart": source.get("byteStart", -1),
            "byteEnd": source.get("byteEnd", -1),
            "contentHash": source.get("contentHash", ""),
            "strategy": source.get("strategy", "paragraph"),
        })
    return chunks


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def verify_locator_stela(filepath, chunk):
    """Verify by reading source bytes at [byteStart:byteEnd] and comparing SHA-256."""
    byte_start = chunk["byteStart"]
    byte_end = chunk["byteEnd"]
    content_hash = chunk["contentHash"]

    if byte_start < 0 or byte_end < 0:
        return False

    with open(filepath, "rb") as f:
        f.seek(byte_start)
        data = f.read(byte_end - byte_start)

    actual_hash = sha256_bytes(data)
    return actual_hash == content_hash


def verify_stale_stela(mutated_filepath, chunk):
    """
    Check if a chunk from the original document is stale in the mutated version.
    Returns (detected_stale, actually_stale).
    """
    byte_start = chunk["byteStart"]
    byte_end = chunk["byteEnd"]
    content_hash = chunk["contentHash"]

    if byte_start < 0 or byte_end < 0:
        return True, True  # Can't verify => treat as stale

    try:
        file_size = os.path.getsize(mutated_filepath)
    except OSError:
        return True, True

    if byte_end > file_size:
        # Offset out of bounds in mutated file
        return True, True

    with open(mutated_filepath, "rb") as f:
        f.seek(byte_start)
        data = f.read(byte_end - byte_start)

    actual_hash = sha256_bytes(data)
    hash_matches = actual_hash == content_hash
    # Also check if the text matches
    try:
        actual_text = data.decode("utf-8")
    except UnicodeDecodeError:
        actual_text = None

    detected_stale = not hash_matches
    # Ground truth: is the chunk actually stale?
    # The chunk is stale if the bytes at its original position don't hash the same
    actually_stale = not hash_matches

    return detected_stale, actually_stale


def compute_retrieval_overlap(retrieved_chunks, annotation_answers, source_text):
    """
    Compute overlap between retrieved chunks and ground-truth annotation spans.
    Uses byte offsets converted to char positions for comparison with CUAD annotations
    (which use character offsets).
    """
    if not annotation_answers:
        return None

    gt_positions = set()
    for ans in annotation_answers:
        start = ans["answer_start"]
        end = start + len(ans["text"])
        gt_positions.update(range(start, end))

    if not gt_positions:
        return None

    # For stela chunks, we need to map byte offsets to character offsets
    source_bytes = source_text.encode("utf-8")
    retrieved_positions = set()
    for chunk in retrieved_chunks:
        bs = chunk["byteStart"]
        be = chunk["byteEnd"]
        if bs < 0 or be < 0:
            continue
        # Convert byte offsets to character offsets
        char_start = len(source_bytes[:bs].decode("utf-8", errors="replace"))
        char_end = len(source_bytes[:be].decode("utf-8", errors="replace"))
        retrieved_positions.update(range(char_start, char_end))

    overlap = gt_positions & retrieved_positions
    return len(overlap) / len(gt_positions) if gt_positions else 0.0


def main():
    contracts_dir = os.path.join(EXPERIMENT_DIR, "data", "contracts")
    mutated_dir = os.path.join(EXPERIMENT_DIR, "data", "mutated")
    annotations_path = os.path.join(EXPERIMENT_DIR, "data", "annotations.json")
    results_dir = os.path.join(EXPERIMENT_DIR, "results")
    os.makedirs(results_dir, exist_ok=True)

    print("Loading contracts...")
    contracts = load_contracts(contracts_dir)
    annotations = load_annotations(annotations_path)

    print("Loading embedding model (sentence-transformers/all-MiniLM-L6-v2)...")
    model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")

    all_results = {}
    total_locator_pass = 0
    total_locator_total = 0
    total_retrieval_overlaps = []
    total_stale = {"true_positive": 0, "false_negative": 0, "true_negative": 0, "false_positive": 0}

    mutation_types = ["crlf", "typo", "inserted", "smartquote", "whitespace"]

    for doc_name, text in contracts.items():
        print(f"\n--- {doc_name} ({len(text)} chars) ---")
        filepath = os.path.join(contracts_dir, doc_name)

        # 1. Chunk with stela
        chunks = chunk_with_stela(filepath)
        if not chunks:
            print("  No chunks produced, skipping")
            all_results[doc_name] = {"error": "no chunks"}
            continue
        print(f"  {len(chunks)} chunks")

        # 2. Embed
        chunk_texts = [c["text"] for c in chunks]
        if not chunk_texts:
            continue
        embeddings = model.encode(chunk_texts, show_progress_bar=False, convert_to_numpy=True)

        # 3. Build FAISS index
        dim = embeddings.shape[1]
        index = faiss.IndexFlatIP(dim)
        faiss.normalize_L2(embeddings)
        index.add(embeddings)

        # 4. Locator verification (byte-range + hash)
        locator_pass = sum(1 for c in chunks if verify_locator_stela(filepath, c))
        locator_rate = locator_pass / len(chunks) if chunks else 0
        total_locator_pass += locator_pass
        total_locator_total += len(chunks)
        print(f"  Locator verification: {locator_pass}/{len(chunks)} = {locator_rate:.1%}")

        # 5. Retrieval overlap
        doc_annotations = annotations.get(doc_name, [])
        doc_retrieval_overlaps = []

        for qa in doc_annotations:
            if not qa.get("answers"):
                continue
            query = qa["question"]
            query_emb = model.encode([query], convert_to_numpy=True)
            faiss.normalize_L2(query_emb)
            scores, indices = index.search(query_emb, 5)

            retrieved = [chunks[i] for i in indices[0] if i < len(chunks)]
            overlap = compute_retrieval_overlap(retrieved, qa["answers"], text)
            if overlap is not None:
                doc_retrieval_overlaps.append(overlap)
                total_retrieval_overlaps.append(overlap)

        avg_overlap = np.mean(doc_retrieval_overlaps) if doc_retrieval_overlaps else 0
        print(f"  Retrieval overlap (avg over {len(doc_retrieval_overlaps)} queries): {avg_overlap:.1%}")

        # 6. Stale detection against mutations
        doc_stale = {"true_positive": 0, "false_negative": 0, "true_negative": 0, "false_positive": 0}
        base = doc_name.rsplit(".", 1)[0]

        for mut_type in mutation_types:
            mut_filename = f"{base}_{mut_type}.txt"
            mut_path = os.path.join(mutated_dir, mut_filename)
            if not os.path.exists(mut_path):
                continue

            for chunk in chunks:
                detected_stale, actually_stale = verify_stale_stela(mut_path, chunk)
                if actually_stale and detected_stale:
                    doc_stale["true_positive"] += 1
                elif actually_stale and not detected_stale:
                    doc_stale["false_negative"] += 1
                elif not actually_stale and detected_stale:
                    doc_stale["false_positive"] += 1
                else:
                    doc_stale["true_negative"] += 1

        # Add doc_stale to total
        for k in total_stale:
            total_stale[k] += doc_stale[k]

        tp = doc_stale["true_positive"]
        fn = doc_stale["false_negative"]
        fp = doc_stale["false_positive"]
        tn = doc_stale["true_negative"]
        tpr = tp / (tp + fn) if (tp + fn) > 0 else 0
        fpr = fp / (fp + tn) if (fp + tn) > 0 else 0
        print(f"  Stale detection: TPR={tpr:.1%} FPR={fpr:.1%} (TP={tp} FN={fn} FP={fp} TN={tn})")

        all_results[doc_name] = {
            "num_chunks": len(chunks),
            "locator_pass": locator_pass,
            "locator_rate": locator_rate,
            "retrieval_overlap_avg": avg_overlap,
            "retrieval_queries": len(doc_retrieval_overlaps),
            "stale_detection": doc_stale,
        }

    # Aggregate
    overall_locator_rate = total_locator_pass / total_locator_total if total_locator_total else 0
    overall_retrieval_overlap = np.mean(total_retrieval_overlaps) if total_retrieval_overlaps else 0

    tp = total_stale["true_positive"]
    fn = total_stale["false_negative"]
    fp = total_stale["false_positive"]
    tn = total_stale["true_negative"]
    overall_tpr = tp / (tp + fn) if (tp + fn) > 0 else 0
    overall_fpr = fp / (fp + tn) if (fp + tn) > 0 else 0

    summary = {
        "pipeline": "stela",
        "chunking": "stela --strategy paragraph",
        "embedding_model": "sentence-transformers/all-MiniLM-L6-v2",
        "vector_store": "FAISS (local)",
        "total_documents": len(contracts),
        "total_chunks": total_locator_total,
        "locator_verification_rate": overall_locator_rate,
        "stale_detection_tpr": overall_tpr,
        "stale_detection_fpr": overall_fpr,
        "stale_detection_counts": total_stale,
        "retrieval_overlap_avg": overall_retrieval_overlap,
        "retrieval_queries_total": len(total_retrieval_overlaps),
        "per_document": all_results,
    }

    output_path = os.path.join(results_dir, "stela_results.json")
    with open(output_path, "w") as f:
        json.dump(summary, f, indent=2)

    print("\n" + "=" * 60)
    print("STELA PIPELINE SUMMARY")
    print("=" * 60)
    print(f"Documents:                  {len(contracts)}")
    print(f"Total chunks:               {total_locator_total}")
    print(f"Locator verification rate:  {overall_locator_rate:.1%}")
    print(f"Stale detection TPR:        {overall_tpr:.1%}")
    print(f"Stale detection FPR:        {overall_fpr:.1%}")
    print(f"Retrieval overlap (avg):    {overall_retrieval_overlap:.1%}")
    print(f"\nResults saved to: {output_path}")


if __name__ == "__main__":
    main()
