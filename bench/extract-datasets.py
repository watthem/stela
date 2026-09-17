"""Extract parquet datasets to NDJSON for the stress test harness."""
import json
import os
import pyarrow.parquet as pq

DATA = os.path.expanduser("~/Code/stela/bench/data")

def extract(parquet_path, out_path, text_col="text", extra_cols=None):
    if extra_cols is None:
        extra_cols = []
    table = pq.read_table(parquet_path)
    cols = {c: table.column(c).to_pylist() for c in [text_col] + extra_cols if c in table.column_names}
    n = len(cols[text_col])
    with open(out_path, "w") as f:
        for i in range(n):
            row = {c: cols[c][i] for c in cols}
            f.write(json.dumps(row) + "\n")
    print(f"  Wrote {n} rows to {out_path}")

# Wikipedia-100k
wiki_path = os.path.join(DATA, "wikipedia-100k/data/train-00000-of-00001.parquet")
if os.path.exists(wiki_path):
    print("Extracting Wikipedia-100k...")
    extract(wiki_path, os.path.join(DATA, "wikipedia-100k.ndjson"), extra_cols=["title", "id"])
else:
    print(f"Wikipedia not found at {wiki_path}")

# SEC 2024
sec_path = os.path.join(DATA, "sec/2024.parquet")
if os.path.exists(sec_path):
    print("Extracting SEC 2024...")
    extract(sec_path, os.path.join(DATA, "sec-2024.ndjson"), extra_cols=["filename", "id", "cik"])
else:
    print(f"SEC not found at {sec_path}")
