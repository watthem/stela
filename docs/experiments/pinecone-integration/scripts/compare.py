#!/usr/bin/env python3
"""
Compare baseline and stela pipeline results and produce a summary table.

Usage:
    python scripts/compare.py
"""

import json
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
EXPERIMENT_DIR = os.path.dirname(SCRIPT_DIR)


def load_results(path):
    with open(path) as f:
        return json.load(f)


def main():
    results_dir = os.path.join(EXPERIMENT_DIR, "results")
    baseline_path = os.path.join(results_dir, "baseline_results.json")
    stela_path = os.path.join(results_dir, "stela_results.json")

    if not os.path.exists(baseline_path):
        print(f"ERROR: baseline results not found at {baseline_path}")
        print("Run: python scripts/baseline_pipeline.py")
        sys.exit(1)

    if not os.path.exists(stela_path):
        print(f"ERROR: stela results not found at {stela_path}")
        print("Run: python scripts/stela_pipeline.py")
        sys.exit(1)

    baseline = load_results(baseline_path)
    stela = load_results(stela_path)

    # Format percentages
    def pct(v):
        return f"{v * 100:.1f}%"

    def na_or_pct(v, label=""):
        if v is None:
            return "N/A"
        return pct(v)

    # Build comparison table
    rows = [
        ("Metric", "Baseline", "stela", "Delta"),
        ("-" * 30, "-" * 12, "-" * 12, "-" * 10),
        (
            "Total chunks",
            str(baseline["total_chunks"]),
            str(stela["total_chunks"]),
            "",
        ),
        (
            "Locator verification rate",
            pct(baseline["locator_verification_rate"]),
            pct(stela["locator_verification_rate"]),
            pct(stela["locator_verification_rate"] - baseline["locator_verification_rate"]),
        ),
        (
            "Stale detection TPR",
            pct(baseline["stale_detection_tpr"]),
            pct(stela["stale_detection_tpr"]),
            pct(stela["stale_detection_tpr"] - baseline["stale_detection_tpr"]),
        ),
        (
            "Stale detection FPR",
            pct(baseline["stale_detection_fpr"]),
            pct(stela["stale_detection_fpr"]),
            pct(stela["stale_detection_fpr"] - baseline["stale_detection_fpr"]),
        ),
        (
            "Retrieval overlap (top-5)",
            pct(baseline["retrieval_overlap_avg"]),
            pct(stela["retrieval_overlap_avg"]),
            pct(stela["retrieval_overlap_avg"] - baseline["retrieval_overlap_avg"]),
        ),
    ]

    # Print table
    col_widths = [30, 12, 12, 10]
    print("\n" + "=" * 70)
    print("PIPELINE COMPARISON: Baseline vs stela")
    print("=" * 70)
    print()

    for row in rows:
        line = " | ".join(str(cell).ljust(w) for cell, w in zip(row, col_widths))
        print(line)

    print()

    # Stale detection breakdown
    print("Stale Detection Breakdown:")
    print(f"  Baseline: TP={baseline['stale_detection_counts']['true_positive']}"
          f" FN={baseline['stale_detection_counts']['false_negative']}"
          f" FP={baseline['stale_detection_counts']['false_positive']}"
          f" TN={baseline['stale_detection_counts']['true_negative']}")
    print(f"  stela:    TP={stela['stale_detection_counts']['true_positive']}"
          f" FN={stela['stale_detection_counts']['false_negative']}"
          f" FP={stela['stale_detection_counts']['false_positive']}"
          f" TN={stela['stale_detection_counts']['true_negative']}")

    print()

    # Per-document comparison
    print("Per-document locator verification:")
    print(f"  {'Document':<65} {'Base':>6} {'stela':>6}")
    print(f"  {'-'*65} {'-'*6} {'-'*6}")

    for doc_name in sorted(baseline["per_document"].keys()):
        b = baseline["per_document"].get(doc_name, {})
        s = stela["per_document"].get(doc_name, {})
        if "error" in b or "error" in s:
            continue
        b_rate = b.get("locator_rate", 0)
        s_rate = s.get("locator_rate", 0)
        short_name = doc_name[:63] + ".." if len(doc_name) > 65 else doc_name
        print(f"  {short_name:<65} {pct(b_rate):>6} {pct(s_rate):>6}")

    print()

    # Generate markdown report
    md_path = os.path.join(EXPERIMENT_DIR, "baseline-results.md")
    with open(md_path, "w") as f:
        f.write("# Baseline Benchmark Results\n\n")
        f.write("## Experiment Configuration\n\n")
        f.write(f"- **Dataset**: CUAD (Contract Understanding Atticus Dataset), {baseline['total_documents']} contracts\n")
        f.write(f"- **Baseline chunking**: {baseline['chunking']}\n")
        f.write(f"- **stela chunking**: {stela['chunking']}\n")
        f.write(f"- **Embedding model**: {baseline['embedding_model']}\n")
        f.write(f"- **Vector store**: {baseline['vector_store']}\n")
        f.write(f"- **Retrieval**: top-5 cosine similarity\n")
        f.write(f"- **Mutations tested**: CRLF, typo fix, inserted section, smart quotes, whitespace collapse\n\n")

        f.write("## Summary\n\n")
        f.write("| Metric | Baseline | stela | Delta |\n")
        f.write("|--------|----------|-------|-------|\n")
        f.write(f"| Total chunks | {baseline['total_chunks']} | {stela['total_chunks']} | |\n")
        f.write(f"| Locator verification rate | {pct(baseline['locator_verification_rate'])} | {pct(stela['locator_verification_rate'])} | {pct(stela['locator_verification_rate'] - baseline['locator_verification_rate'])} |\n")
        f.write(f"| Stale detection TPR | {pct(baseline['stale_detection_tpr'])} | {pct(stela['stale_detection_tpr'])} | {pct(stela['stale_detection_tpr'] - baseline['stale_detection_tpr'])} |\n")
        f.write(f"| Stale detection FPR | {pct(baseline['stale_detection_fpr'])} | {pct(stela['stale_detection_fpr'])} | {pct(stela['stale_detection_fpr'] - baseline['stale_detection_fpr'])} |\n")
        f.write(f"| Retrieval overlap (top-5) | {pct(baseline['retrieval_overlap_avg'])} | {pct(stela['retrieval_overlap_avg'])} | {pct(stela['retrieval_overlap_avg'] - baseline['retrieval_overlap_avg'])} |\n\n")

        f.write("## Interpretation\n\n")
        f.write("### Locator Verification\n\n")
        f.write("Locator verification tests whether a stored chunk can be traced back to its exact position in the source document.\n\n")
        f.write("- **Baseline**: uses character `start_index` from LangChain. Slices the source string at that offset and compares text.\n")
        f.write("- **stela**: uses byte offsets (`byteStart`/`byteEnd`) and SHA-256 `contentHash`. Reads the source file bytes at the stored range and verifies the hash.\n\n")

        f.write("### Stale Detection\n\n")
        f.write("Stale detection tests whether the system can identify that stored chunks no longer match a modified version of the source document.\n\n")
        f.write("- **Baseline**: can only compare text at stored character offsets, which may shift after mutations. Has no hash to detect content changes at the same offset.\n")
        f.write("- **stela**: compares SHA-256 hash of bytes at the stored range against the stored `contentHash`. Any byte-level change is detected.\n\n")

        f.write("### Retrieval Overlap\n\n")
        f.write("Retrieval overlap measures how much of the CUAD ground-truth annotated spans are covered by the top-5 retrieved chunks for each question.\n")
        f.write("This is expected to differ between pipelines because they produce different chunk boundaries.\n\n")

        f.write("## Stale Detection Breakdown\n\n")
        f.write("| Pipeline | TP | FN | FP | TN |\n")
        f.write("|----------|-----|-----|-----|-----|\n")
        f.write(f"| Baseline | {baseline['stale_detection_counts']['true_positive']} | {baseline['stale_detection_counts']['false_negative']} | {baseline['stale_detection_counts']['false_positive']} | {baseline['stale_detection_counts']['true_negative']} |\n")
        f.write(f"| stela | {stela['stale_detection_counts']['true_positive']} | {stela['stale_detection_counts']['false_negative']} | {stela['stale_detection_counts']['false_positive']} | {stela['stale_detection_counts']['true_negative']} |\n\n")

        f.write("## Per-Document Results\n\n")
        f.write("| Document | Chunks (B/S) | Locator (B/S) | Retrieval (B/S) |\n")
        f.write("|----------|-------------|--------------|----------------|\n")
        for doc_name in sorted(baseline["per_document"].keys()):
            b = baseline["per_document"].get(doc_name, {})
            s = stela["per_document"].get(doc_name, {})
            if "error" in b or "error" in s:
                continue
            short = doc_name[:45] + ".." if len(doc_name) > 47 else doc_name
            f.write(f"| {short} | {b.get('num_chunks',0)}/{s.get('num_chunks',0)} | {pct(b.get('locator_rate',0))}/{pct(s.get('locator_rate',0))} | {pct(b.get('retrieval_overlap_avg',0))}/{pct(s.get('retrieval_overlap_avg',0))} |\n")

    print(f"Markdown report saved to: {md_path}")


if __name__ == "__main__":
    main()
