#!/usr/bin/env python3
"""
Optimized stela retrieval pipeline with toggleable optimizations.

Optimizations (applied in order, each independently toggleable):
  1. --strip-boilerplate : Remove CUAD query prefix before embedding
  2. --multi-strategy    : Sentence-level retrieval with paragraph promotion
  3. --hybrid-bm25       : BM25 + dense hybrid with Reciprocal Rank Fusion
  4. --embedding-model    : Alternative embedding model (default: MiniLM)

Extended metrics are always computed:
  - Retrieval overlap (existing)
  - Precision@5, IoU@5, clause-intact rate, complete-grounding@5

Usage:
    python scripts/optimized_pipeline.py --strip-boilerplate --multi-strategy --hybrid-bm25
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
EXPERIMENT_DIR = os.path.dirname(SCRIPT_DIR)
VENV_SITE = os.path.join(EXPERIMENT_DIR, ".venv", "lib")
for d in os.listdir(VENV_SITE) if os.path.isdir(VENV_SITE) else []:
    sp = os.path.join(VENV_SITE, d, "site-packages")
    if os.path.isdir(sp) and sp not in sys.path:
        sys.path.insert(0, sp)

import numpy as np

import torch
torch.cuda.is_available = lambda: False
os.environ["CUDA_VISIBLE_DEVICES"] = ""

from sentence_transformers import SentenceTransformer
import faiss

STELA_DIR = "/home/watthem/Code/stela"

# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_contracts(contracts_dir):
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


# ---------------------------------------------------------------------------
# Optimization 1: Strip CUAD boilerplate from queries
# ---------------------------------------------------------------------------

def strip_cuad_boilerplate(query):
    """
    CUAD queries follow the pattern:
      'Highlight the parts (if any) of this contract related to "<X>"
       that should be reviewed by a lawyer. Details: <actual question>'

    The prefix is ~110-120 characters of template text that wastes embedding
    capacity (MiniLM has a 256-token window).  Strip it and return only the
    meaningful part after "Details: ".  If the pattern isn't found, extract
    the quoted category name as a fallback.
    """
    idx = query.find("Details: ")
    if idx >= 0:
        return query[idx + len("Details: "):]

    # Fallback: extract quoted category name
    m = re.search(r'"([^"]+)"', query)
    if m:
        return m.group(1)

    return query


# ---------------------------------------------------------------------------
# Stela chunking (single or multi-strategy)
# ---------------------------------------------------------------------------

def chunk_with_stela(filepath, strategy="paragraph"):
    """Run stela CLI with the given strategy and parse JSON output."""
    result = subprocess.run(
        ["npx", "@watthem/stela", filepath, "--strategy", strategy, "--json"],
        capture_output=True,
        text=True,
        cwd=STELA_DIR,
        timeout=120,
    )
    if result.returncode != 0:
        print(f"  stela error ({strategy}): {result.stderr[:200]}")
        return []
    try:
        chunks_raw = json.loads(result.stdout)
    except json.JSONDecodeError as e:
        print(f"  stela JSON parse error ({strategy}): {e}")
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
            "strategy": source.get("strategy", strategy),
        })
    return chunks


def get_chunks(filepath, multi_strategy=False):
    """
    Return (index_chunks, paragraph_chunks).

    If multi_strategy is False, both are the paragraph chunks (baseline behavior).
    If multi_strategy is True, index_chunks are sentence-level (used for FAISS)
    and paragraph_chunks are used for promotion.
    """
    para_chunks = chunk_with_stela(filepath, strategy="paragraph")
    if not multi_strategy:
        return para_chunks, para_chunks

    sent_chunks = chunk_with_stela(filepath, strategy="sentence")
    if not sent_chunks:
        # Fall back to paragraph-only
        return para_chunks, para_chunks

    return sent_chunks, para_chunks


# ---------------------------------------------------------------------------
# Optimization 2: Byte-range promotion (sentence -> paragraph)
# ---------------------------------------------------------------------------

def promote_to_paragraph(sentence_chunks, paragraph_chunks, scores=None):
    """
    Promote each sentence chunk to its enclosing paragraph chunk by
    byte-range containment: a sentence [s_start, s_end) is inside a
    paragraph [p_start, p_end) if p_start <= s_start and s_end <= p_end.

    Returns a list of (paragraph_chunk, best_score) tuples, deduped.
    """
    promoted = []
    seen_para_indices = {}  # para chunk_index -> best_score

    for i, sc in enumerate(sentence_chunks):
        s_start = sc["byteStart"]
        s_end = sc["byteEnd"]
        score = scores[i] if scores is not None else 1.0

        if s_start < 0 or s_end < 0:
            # Can't promote — use the sentence chunk itself as fallback
            promoted.append((sc, score))
            continue

        # Find enclosing paragraph
        found = False
        for pc in paragraph_chunks:
            p_start = pc["byteStart"]
            p_end = pc["byteEnd"]
            if p_start < 0 or p_end < 0:
                continue
            if p_start <= s_start and s_end <= p_end:
                key = (pc["byteStart"], pc["byteEnd"])
                if key not in seen_para_indices or score > seen_para_indices[key][1]:
                    seen_para_indices[key] = (pc, score)
                found = True
                break

        if not found:
            # No enclosing paragraph found — use sentence chunk as-is
            promoted.append((sc, score))

    # Add unique promoted paragraphs
    promoted.extend(seen_para_indices.values())

    # Dedup overlapping regions: if two promoted spans overlap by >= 75% of
    # the shorter span, keep only the higher-scoring one
    promoted.sort(key=lambda x: x[1], reverse=True)
    deduped = []
    for chunk, score in promoted:
        cs, ce = chunk["byteStart"], chunk["byteEnd"]
        if cs < 0 or ce < 0:
            deduped.append((chunk, score))
            continue
        overlap_too_much = False
        for existing, _ in deduped:
            es, ee = existing["byteStart"], existing["byteEnd"]
            if es < 0 or ee < 0:
                continue
            overlap_start = max(cs, es)
            overlap_end = min(ce, ee)
            if overlap_start < overlap_end:
                overlap_len = overlap_end - overlap_start
                shorter_len = min(ce - cs, ee - es)
                if shorter_len > 0 and overlap_len / shorter_len >= 0.75:
                    overlap_too_much = True
                    break
        if not overlap_too_much:
            deduped.append((chunk, score))

    return deduped


# ---------------------------------------------------------------------------
# Optimization 3: BM25 + dense hybrid with RRF
# ---------------------------------------------------------------------------

def build_bm25_index(chunks):
    """Build a BM25 index over chunk texts."""
    from rank_bm25 import BM25Okapi
    tokenized = [c["text"].lower().split() for c in chunks]
    return BM25Okapi(tokenized)


def rrf_fuse(dense_indices, dense_scores, bm25_indices, k=60, top_n=20):
    """
    Reciprocal Rank Fusion.
    score(d) = 1/(k + rank_dense(d)) + 1/(k + rank_bm25(d))
    Returns top_n fused (index, score) pairs.
    """
    scores = {}

    for rank, idx in enumerate(dense_indices):
        scores[idx] = scores.get(idx, 0) + 1.0 / (k + rank + 1)

    for rank, idx in enumerate(bm25_indices):
        scores[idx] = scores.get(idx, 0) + 1.0 / (k + rank + 1)

    fused = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    return fused[:top_n]


# ---------------------------------------------------------------------------
# Retrieval
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------

def byte_to_char_ranges(source_text, chunks):
    """Convert byte-offset chunks to character-position sets."""
    source_bytes = source_text.encode("utf-8")
    positions = set()
    for chunk in chunks:
        bs = chunk["byteStart"]
        be = chunk["byteEnd"]
        if bs < 0 or be < 0:
            continue
        char_start = len(source_bytes[:bs].decode("utf-8", errors="replace"))
        char_end = len(source_bytes[:be].decode("utf-8", errors="replace"))
        positions.update(range(char_start, char_end))
    return positions


def compute_gt_positions(answers):
    """Build set of character positions from ground-truth annotations."""
    positions = set()
    for ans in answers:
        start = ans["answer_start"]
        end = start + len(ans["text"])
        positions.update(range(start, end))
    return positions


def compute_gt_spans(answers):
    """Return list of (start, end) tuples for ground-truth spans."""
    spans = []
    for ans in answers:
        start = ans["answer_start"]
        end = start + len(ans["text"])
        spans.append((start, end))
    return spans


def retrieval_overlap(retrieved_positions, gt_positions):
    """Fraction of GT characters covered by retrieved chunks."""
    if not gt_positions:
        return None
    overlap = gt_positions & retrieved_positions
    return len(overlap) / len(gt_positions)


def precision_at_k(retrieved_positions, gt_positions):
    """Fraction of retrieved characters that overlap with any GT span."""
    if not retrieved_positions:
        return 0.0
    overlap = retrieved_positions & gt_positions
    return len(overlap) / len(retrieved_positions)


def iou_at_k(retrieved_positions, gt_positions):
    """Intersection over union at the character level."""
    if not retrieved_positions and not gt_positions:
        return 1.0
    union = retrieved_positions | gt_positions
    if not union:
        return 1.0
    intersection = retrieved_positions & gt_positions
    return len(intersection) / len(union)


def clause_intact_rate(chunks, answers, source_text):
    """
    Fraction of gold spans that are fully contained within a single chunk.
    Measures whether chunking preserved clause boundaries.
    """
    if not answers:
        return None

    source_bytes = source_text.encode("utf-8")

    # Build chunk character ranges
    chunk_ranges = []
    for chunk in chunks:
        bs = chunk["byteStart"]
        be = chunk["byteEnd"]
        if bs < 0 or be < 0:
            continue
        char_start = len(source_bytes[:bs].decode("utf-8", errors="replace"))
        char_end = len(source_bytes[:be].decode("utf-8", errors="replace"))
        chunk_ranges.append((char_start, char_end))

    gt_spans = compute_gt_spans(answers)
    intact = 0
    for gs, ge in gt_spans:
        for cs, ce in chunk_ranges:
            if cs <= gs and ge <= ce:
                intact += 1
                break

    return intact / len(gt_spans) if gt_spans else 0.0


def complete_grounding_at_k(retrieved_positions, answers):
    """
    Fraction of gold spans that are fully covered by the union of
    top-k retrieved chunks.
    """
    if not answers:
        return None

    gt_spans = compute_gt_spans(answers)
    fully_covered = 0
    for gs, ge in gt_spans:
        span_positions = set(range(gs, ge))
        if span_positions and span_positions.issubset(retrieved_positions):
            fully_covered += 1

    return fully_covered / len(gt_spans) if gt_spans else 0.0


def compute_all_metrics(retrieved_chunks, answers, source_text, all_chunks):
    """
    Compute all metrics for a single query.
    Returns a dict with all metric values.
    """
    if not answers:
        return None

    gt_positions = compute_gt_positions(answers)
    if not gt_positions:
        return None

    retrieved_positions = byte_to_char_ranges(source_text, retrieved_chunks)

    ro = retrieval_overlap(retrieved_positions, gt_positions)
    p5 = precision_at_k(retrieved_positions, gt_positions)
    iou = iou_at_k(retrieved_positions, gt_positions)
    cg5 = complete_grounding_at_k(retrieved_positions, answers)
    ci = clause_intact_rate(all_chunks, answers, source_text)

    return {
        "retrieval_overlap": ro,
        "precision_at_5": p5,
        "iou_at_5": iou,
        "complete_grounding_at_5": cg5,
        "clause_intact_rate": ci,
    }


# ---------------------------------------------------------------------------
# Embedding model loader
# ---------------------------------------------------------------------------

def load_embedding_model(model_name):
    """Load an embedding model. Tries SentenceTransformer first, then HF."""
    print(f"Loading embedding model: {model_name}")
    t0 = time.time()

    if "Qwen" in model_name or "qwen" in model_name:
        # Try loading with HuggingFace transformers directly
        try:
            from transformers import AutoModel, AutoTokenizer
            print("  Attempting HuggingFace transformers load...")
            tokenizer = AutoTokenizer.from_pretrained(model_name, trust_remote_code=True)
            hf_model = AutoModel.from_pretrained(model_name, trust_remote_code=True)
            hf_model.eval()
            elapsed = time.time() - t0
            print(f"  Loaded via HuggingFace transformers in {elapsed:.1f}s")
            return ("hf", hf_model, tokenizer)
        except Exception as e:
            print(f"  HuggingFace load failed: {e}")
            print("  Falling back to sentence-transformers...")

    try:
        model = SentenceTransformer(model_name)
        elapsed = time.time() - t0
        print(f"  Loaded in {elapsed:.1f}s")
        return ("st", model, None)
    except Exception as e:
        print(f"  SentenceTransformer load failed: {e}")
        raise


def encode_texts(model_tuple, texts, batch_size=32):
    """Encode texts using the loaded model."""
    kind, model, tokenizer = model_tuple
    if kind == "st":
        return model.encode(texts, show_progress_bar=False, convert_to_numpy=True,
                           batch_size=batch_size)
    elif kind == "hf":
        # HuggingFace transformers model
        all_embeddings = []
        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            inputs = tokenizer(batch, padding=True, truncation=True,
                             max_length=512, return_tensors="pt")
            with torch.no_grad():
                outputs = model(**inputs)
            # Mean pooling over token embeddings
            attention_mask = inputs["attention_mask"]
            token_embeddings = outputs.last_hidden_state
            mask_expanded = attention_mask.unsqueeze(-1).expand(token_embeddings.size()).float()
            sum_embeddings = torch.sum(token_embeddings * mask_expanded, 1)
            sum_mask = torch.clamp(mask_expanded.sum(1), min=1e-9)
            embeddings = (sum_embeddings / sum_mask).numpy()
            all_embeddings.append(embeddings)
        return np.vstack(all_embeddings)


_global_model_tuple = None


def retrieve(query, faiss_index, index_chunks, paragraph_chunks,
             bm25_index, args, top_k=5, top_retrieve=20):
    """
    Run the full retrieval pipeline with configured optimizations.
    Uses the module-level _global_model_tuple for encoding.
    Returns (retrieved_chunks, retrieval_scores).
    """
    global _global_model_tuple

    q = strip_cuad_boilerplate(query) if args.strip_boilerplate else query

    query_emb = encode_texts(_global_model_tuple, [q])
    faiss.normalize_L2(query_emb)
    dense_scores, dense_raw_indices = faiss_index.search(query_emb, top_retrieve)
    dense_indices = [int(i) for i in dense_raw_indices[0] if i < len(index_chunks)]
    dense_score_list = [float(s) for s, i in zip(dense_scores[0], dense_raw_indices[0])
                        if i < len(index_chunks)]

    if args.hybrid_bm25 and bm25_index is not None:
        q_tokens = q.lower().split()
        bm25_scores = bm25_index.get_scores(q_tokens)
        bm25_top = np.argsort(bm25_scores)[::-1][:top_retrieve].tolist()
        fused = rrf_fuse(dense_indices, dense_score_list, bm25_top, k=60, top_n=top_retrieve)
        result_indices = [idx for idx, _ in fused]
        result_scores = [score for _, score in fused]
    else:
        result_indices = dense_indices[:top_retrieve]
        result_scores = dense_score_list[:top_retrieve]

    retrieved = [(index_chunks[i], result_scores[rank])
                 for rank, i in enumerate(result_indices) if i < len(index_chunks)]

    if args.multi_strategy and paragraph_chunks is not index_chunks:
        sentence_chunks = [r[0] for r in retrieved]
        scores = [r[1] for r in retrieved]
        promoted = promote_to_paragraph(sentence_chunks, paragraph_chunks, scores)
        final = promoted[:top_k]
    else:
        final = retrieved[:top_k]

    return [c for c, s in final], [s for c, s in final]


def run_pipeline(args):
    """Main pipeline: chunk, embed, retrieve, evaluate across all contracts."""
    global _global_model_tuple

    contracts_dir = os.path.join(EXPERIMENT_DIR, "data", "contracts")
    annotations_path = os.path.join(EXPERIMENT_DIR, "data", "annotations.json")
    results_dir = os.path.join(EXPERIMENT_DIR, "results")
    os.makedirs(results_dir, exist_ok=True)

    print("Loading contracts...")
    contracts = load_contracts(contracts_dir)
    annotations = load_annotations(annotations_path)

    _global_model_tuple = load_embedding_model(args.embedding_model)

    config_parts = ["stela paragraph"]
    if args.strip_boilerplate:
        config_parts.append("strip-boilerplate")
    if args.multi_strategy:
        config_parts.append("multi-strategy")
    if args.hybrid_bm25:
        config_parts.append("hybrid-bm25")
    config_name = " + ".join(config_parts)
    print(f"\nConfiguration: {config_name}")
    print(f"Embedding model: {args.embedding_model}")

    all_metrics = {
        "retrieval_overlap": [],
        "precision_at_5": [],
        "iou_at_5": [],
        "complete_grounding_at_5": [],
        "clause_intact_rate": [],
    }
    per_doc_results = {}
    total_queries = 0
    total_time = time.time()

    for doc_name, text in contracts.items():
        print(f"\n--- {doc_name} ({len(text)} chars) ---")
        filepath = os.path.join(contracts_dir, doc_name)

        index_chunks, para_chunks = get_chunks(filepath, multi_strategy=args.multi_strategy)
        if not index_chunks:
            print("  No chunks produced, skipping")
            per_doc_results[doc_name] = {"error": "no chunks"}
            continue

        strategy_label = "sentence+paragraph" if args.multi_strategy else "paragraph"
        print(f"  {len(index_chunks)} index chunks ({strategy_label})")
        if args.multi_strategy:
            print(f"  {len(para_chunks)} paragraph chunks for promotion")

        chunk_texts = [c["text"] for c in index_chunks]
        if not chunk_texts:
            continue
        embeddings = encode_texts(_global_model_tuple, chunk_texts)

        dim = embeddings.shape[1]
        faiss_index = faiss.IndexFlatIP(dim)
        faiss.normalize_L2(embeddings)
        faiss_index.add(embeddings)

        bm25_index = None
        if args.hybrid_bm25:
            bm25_index = build_bm25_index(index_chunks)

        doc_annotations = annotations.get(doc_name, [])
        doc_metrics = {k: [] for k in all_metrics}

        for qa in doc_annotations:
            if not qa.get("answers"):
                continue
            query = qa["question"]

            retrieved, scores = retrieve(
                query, faiss_index, index_chunks, para_chunks,
                bm25_index, args, top_k=5, top_retrieve=20,
            )

            metrics = compute_all_metrics(retrieved, qa["answers"], text, para_chunks)
            if metrics is not None:
                for k, v in metrics.items():
                    if v is not None:
                        doc_metrics[k].append(v)
                        all_metrics[k].append(v)
                total_queries += 1

        doc_summary = {}
        for k in all_metrics:
            vals = doc_metrics[k]
            doc_summary[k] = np.mean(vals) if vals else 0.0
            doc_summary[f"{k}_n"] = len(vals)

        doc_summary["num_index_chunks"] = len(index_chunks)
        doc_summary["num_para_chunks"] = len(para_chunks)
        per_doc_results[doc_name] = doc_summary

        print(f"  Retrieval overlap: {doc_summary['retrieval_overlap']:.1%}"
              f"  Precision@5: {doc_summary['precision_at_5']:.1%}"
              f"  IoU@5: {doc_summary['iou_at_5']:.1%}")
        print(f"  Complete-grounding@5: {doc_summary['complete_grounding_at_5']:.1%}"
              f"  Clause-intact: {doc_summary['clause_intact_rate']:.1%}")

    elapsed = time.time() - total_time

    summary = {}
    for k in all_metrics:
        vals = all_metrics[k]
        summary[k] = np.mean(vals) if vals else 0.0

    summary["total_queries"] = total_queries
    summary["config"] = config_name
    summary["embedding_model"] = args.embedding_model
    summary["elapsed_seconds"] = elapsed
    summary["per_document"] = {
        k: {mk: float(mv) if isinstance(mv, (np.floating, float)) else mv
            for mk, mv in v.items()}
        for k, v in per_doc_results.items()
    }

    print("\n" + "=" * 70)
    print(f"OPTIMIZED PIPELINE SUMMARY  [{config_name}]")
    print("=" * 70)
    print(f"Embedding model:          {args.embedding_model}")
    print(f"Total queries:            {total_queries}")
    print(f"Elapsed:                  {elapsed:.1f}s")
    print(f"Retrieval overlap (avg):  {summary['retrieval_overlap']:.1%}")
    print(f"Precision@5 (avg):        {summary['precision_at_5']:.1%}")
    print(f"IoU@5 (avg):              {summary['iou_at_5']:.1%}")
    print(f"Complete-grounding@5:     {summary['complete_grounding_at_5']:.1%}")
    print(f"Clause-intact rate:       {summary['clause_intact_rate']:.1%}")

    config_slug = config_name.replace(" + ", "_").replace(" ", "-")
    output_path = os.path.join(results_dir, f"optimized_{config_slug}.json")
    with open(output_path, "w") as f:
        json.dump(summary, f, indent=2, default=float)
    print(f"\nResults saved to: {output_path}")

    return summary


def main():
    parser = argparse.ArgumentParser(
        description="Optimized stela retrieval pipeline with toggleable optimizations"
    )
    parser.add_argument("--strip-boilerplate", action="store_true",
                        help="Strip CUAD query boilerplate before embedding")
    parser.add_argument("--multi-strategy", action="store_true",
                        help="Sentence-level retrieval with paragraph promotion")
    parser.add_argument("--hybrid-bm25", action="store_true",
                        help="BM25 + dense hybrid with RRF")
    parser.add_argument("--embedding-model", type=str,
                        default="sentence-transformers/all-MiniLM-L6-v2",
                        help="Embedding model name (default: MiniLM)")
    args = parser.parse_args()

    run_pipeline(args)


if __name__ == "__main__":
    main()
