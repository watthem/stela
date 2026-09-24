#!/usr/bin/env python3
"""Export embedded paragraphs to Parquet for Apple's Embedding Atlas.

    uv tool install embedding-atlas
    ~/.local/share/uv/tools/embedding-atlas/bin/python atlas_export.py OUT.parquet
    embedding-atlas OUT.parquet --vector embedding --text text

The output holds your notes' text. Write it outside any published repository.
Reads DATABASE_URL via `psql` inside the `stela-pgvector` container (no Python driver needed).
"""
import csv, io, json, os, subprocess, sys

import pyarrow as pa
import pyarrow.parquet as pq

out = sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__)
db = os.environ.get("ATLAS_DB", "vault")
sql = """COPY (SELECT doc_path, byte_start, byte_end, left(text, 2000) AS text, length(text) AS nchars,
                       embedding::text AS embedding
                FROM chunks WHERE kind = 'parent' AND embedding IS NOT NULL ORDER BY doc_path, byte_start)
         TO STDOUT (FORMAT csv, HEADER)"""
raw = subprocess.run(["docker", "exec", "stela-pgvector", "psql", "-U", "postgres", "-d", db, "-c", sql],
                     check=True, capture_output=True, text=True).stdout
csv.field_size_limit(1 << 24)
rows = list(csv.DictReader(io.StringIO(raw)))


def area(path):
    parts = path.split("/")
    if parts[0] == "subvaults" and len(parts) > 2:
        return "/".join(parts[:2])
    return parts[0] if len(parts) > 1 else "(root)"


table = pa.table({
    "source": [f"{r['doc_path']}#bytes={r['byte_start']}-{r['byte_end']}" for r in rows],
    "doc_path": [r["doc_path"] for r in rows],
    "area": [area(r["doc_path"]) for r in rows],
    "text": [r["text"] for r in rows],
    "nchars": [int(r["nchars"]) for r in rows],
    "embedding": pa.array([json.loads(r["embedding"]) for r in rows], type=pa.list_(pa.float32())),
})
pq.write_table(table, out)
print(f"{len(rows)} paragraphs -> {out}")
