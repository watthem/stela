#!/usr/bin/env python3
"""
Run all optimization configurations and produce the results table.

Usage:
    python scripts/run_optimizations.py
"""

import json
import os
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
EXPERIMENT_DIR = os.path.dirname(SCRIPT_DIR)
VENV_PYTHON = os.path.join(EXPERIMENT_DIR, ".venv", "bin", "python")
OPTIMIZED_SCRIPT = os.path.join(SCRIPT_DIR, "optimized_pipeline.py")


CONFIGURATIONS = [
    {
        "name": "stela paragraph (baseline)",
        "flags": [],
    },
    {
        "name": "+ strip boilerplate",
        "flags": ["--strip-boilerplate"],
    },
    {
        "name": "+ multi-strategy",
        "flags": ["--strip-boilerplate", "--multi-strategy"],
    },
    {
        "name": "+ hybrid BM25",
        "flags": ["--strip-boilerplate", "--multi-strategy", "--hybrid-bm25"],
    },
]


def run_config(flags):
    """Run the optimized pipeline with the given flags."""
    cmd = [VENV_PYTHON, OPTIMIZED_SCRIPT] + flags
    print(f"\n{'='*70}")
    print(f"Running: {' '.join(cmd)}")
    print(f"{'='*70}\n")

    result = subprocess.run(cmd, capture_output=False, text=True, timeout=1800)
    return result.returncode


def find_latest_result(config_name):
    """Find the result JSON for a given config name."""
    results_dir = os.path.join(EXPERIMENT_DIR, "results")
    # The config name is encoded in the filename
    for fname in os.listdir(results_dir):
        if fname.startswith("optimized_") and fname.endswith(".json"):
            path = os.path.join(results_dir, fname)
            with open(path) as f:
                data = json.load(f)
            if data.get("config") == config_name:
                return data
    return None


def pct(v):
    return f"{v * 100:.1f}%"


def generate_results_table(results):
    """Generate markdown results table."""
    md_path = os.path.join(EXPERIMENT_DIR, "optimization-results.md")

    with open(md_path, "w") as f:
        f.write("# Retrieval Optimization Results\n\n")
        f.write("## Experiment\n\n")
        f.write("Incremental optimization of the stela + FAISS retrieval pipeline on 15 CUAD contracts.\n")
        f.write("Each row adds one optimization to the previous row's configuration.\n\n")
        f.write(f"- **Dataset**: CUAD, 15 contracts\n")
        f.write(f"- **Embedding model**: {results[0].get('embedding_model', 'MiniLM')}\n")
        f.write(f"- **Vector store**: FAISS (local, CPU)\n")
        f.write(f"- **Retrieval**: top-5, cosine similarity\n\n")

        f.write("## Results\n\n")
        f.write("| Configuration | Retrieval Overlap | Precision@5 | IoU@5 | Complete-Grounding@5 | Clause-Intact | Time |\n")
        f.write("|---|---|---|---|---|---|---|\n")

        baseline_overlap = results[0]["retrieval_overlap"] if results else 0

        for r in results:
            name = r["config"]
            ro = r["retrieval_overlap"]
            delta = ro - baseline_overlap
            delta_str = f" ({'+' if delta >= 0 else ''}{delta*100:.1f}pp)" if name != results[0]["config"] else ""

            f.write(f"| {name} "
                    f"| {pct(ro)}{delta_str} "
                    f"| {pct(r['precision_at_5'])} "
                    f"| {pct(r['iou_at_5'])} "
                    f"| {pct(r['complete_grounding_at_5'])} "
                    f"| {pct(r['clause_intact_rate'])} "
                    f"| {r['elapsed_seconds']:.0f}s |\n")

        f.write("\n")
        f.write("### Metric Definitions\n\n")
        f.write("- **Retrieval Overlap**: fraction of ground-truth annotation characters covered by top-5 retrieved chunks (recall)\n")
        f.write("- **Precision@5**: fraction of retrieved content (by characters) that overlaps with any ground-truth span\n")
        f.write("- **IoU@5**: intersection over union at the character level between retrieved chunks and ground-truth spans\n")
        f.write("- **Clause-Intact Rate**: fraction of gold spans fully contained within a single chunk (boundary preservation)\n")
        f.write("- **Complete-Grounding@5**: fraction of gold spans fully covered by the union of top-5 retrieved chunks\n\n")

        f.write("### Optimization Descriptions\n\n")
        f.write("1. **stela paragraph (baseline)**: stela `--strategy paragraph` chunks indexed in FAISS, unmodified CUAD queries\n")
        f.write("2. **+ strip boilerplate**: Remove the ~110-char CUAD query template prefix (\"Highlight the parts...\") "
                "before embedding, keeping only the meaningful query after \"Details: \"\n")
        f.write("3. **+ multi-strategy**: Index sentence-level stela chunks in FAISS for finer retrieval, "
                "then promote each hit to its enclosing paragraph chunk by byte-range containment. "
                "Dedup overlapping promoted regions (>= 75% overlap of shorter span)\n")
        f.write("4. **+ hybrid BM25**: Add BM25 (Okapi) scoring alongside dense retrieval. "
                "Fuse top-20 results from each with Reciprocal Rank Fusion (k=60). "
                "Apply paragraph promotion after fusion\n")

    print(f"\nResults table written to: {md_path}")
    return md_path


def main():
    all_results = []

    for config in CONFIGURATIONS:
        rc = run_config(config["flags"])
        if rc != 0:
            print(f"\nWARNING: Config '{config['name']}' exited with code {rc}")

    # Collect results in order
    config_names = [
        "stela paragraph",
        "stela paragraph + strip-boilerplate",
        "stela paragraph + strip-boilerplate + multi-strategy",
        "stela paragraph + strip-boilerplate + multi-strategy + hybrid-bm25",
    ]

    results_dir = os.path.join(EXPERIMENT_DIR, "results")
    for cname in config_names:
        r = find_latest_result(cname)
        if r:
            all_results.append(r)
            print(f"  Found results for: {cname}")
        else:
            print(f"  WARNING: No results found for: {cname}")

    if all_results:
        generate_results_table(all_results)
    else:
        print("ERROR: No results collected")
        sys.exit(1)


if __name__ == "__main__":
    main()
