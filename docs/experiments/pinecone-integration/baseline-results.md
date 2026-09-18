# Baseline Benchmark Results

## Experiment Configuration

- **Dataset**: CUAD (Contract Understanding Atticus Dataset), 15 contracts
- **Baseline chunking**: RecursiveCharacterTextSplitter(500, 50)
- **stela chunking**: stela --strategy paragraph
- **Embedding model**: sentence-transformers/all-MiniLM-L6-v2
- **Vector store**: FAISS (local)
- **Retrieval**: top-5 cosine similarity
- **Mutations tested**: CRLF, typo fix, inserted section, smart quotes, whitespace collapse

## Summary

| Metric | Baseline | stela | Delta |
|--------|----------|-------|-------|
| Total chunks | 4532 | 5893 | |
| Locator verification rate | 100.0% | 100.0% | 0.0% |
| Stale detection TPR | 0.0% | 100.0% | 100.0% |
| Stale detection FPR | 0.0% | 0.0% | 0.0% |
| Retrieval overlap (top-5) | 33.9% | 37.3% | 3.4% |

## Interpretation

### Locator Verification

Locator verification tests whether a stored chunk can be traced back to its exact position in the source document.

- **Baseline**: uses character `start_index` from LangChain. Slices the source string at that offset and compares text.
- **stela**: uses byte offsets (`byteStart`/`byteEnd`) and SHA-256 `contentHash`. Reads the source file bytes at the stored range and verifies the hash.

### Stale Detection

Stale detection tests whether the system can identify that stored chunks no longer match a modified version of the source document.

- **Baseline**: can only compare text at stored character offsets, which may shift after mutations. Has no hash to detect content changes at the same offset.
- **stela**: compares SHA-256 hash of bytes at the stored range against the stored `contentHash`. Any byte-level change is detected.

### Retrieval Overlap

Retrieval overlap measures how much of the CUAD ground-truth annotated spans are covered by the top-5 retrieved chunks for each question.
This is expected to differ between pipelines because they produce different chunk boundaries.

## Stale Detection Breakdown

| Pipeline | TP | FN | FP | TN |
|----------|-----|-----|-----|-----|
| Baseline | 0 | 6148 | 0 | 16512 |
| stela | 18944 | 0 | 0 | 10521 |

## Per-Document Results

| Document | Chunks (B/S) | Locator (B/S) | Retrieval (B/S) |
|----------|-------------|--------------|----------------|
| contract_01_XENCORINC_10_25_2013-EX-10_24-COL.. | 342/1061 | 100.0%/100.0% | 14.5%/13.4% |
| contract_02_GluMobileInc_20070319_S-1A_EX-10_.. | 316/511 | 100.0%/100.0% | 35.2%/31.3% |
| contract_03_ReynoldsConsumerProductsInc_20200.. | 330/393 | 100.0%/100.0% | 50.9%/63.5% |
| contract_04_JINGWEIINTERNATIONALLTD_10_04_200.. | 46/77 | 100.0%/100.0% | 55.7%/64.8% |
| contract_05_SUCAMPOPHARMACEUTICALS_INC_11_04_.. | 168/75 | 100.0%/100.0% | 41.3%/37.5% |
| contract_06_RMRGROUPINC_01_22_2020-EX-99_1-JO.. | 2/1 | 100.0%/100.0% | 100.0%/100.0% |
| contract_07_PcquoteComInc_19990721_S-1A_EX-10.. | 2/8 | 100.0%/100.0% | 100.0%/100.0% |
| contract_08_NELNETINC_04_08_2020-EX-1-JOINT_F.. | 4/8 | 100.0%/100.0% | 100.0%/77.4% |
| contract_09_MANUFACTURERSSERVICESLTD_06_05_20.. | 938/1605 | 100.0%/100.0% | 34.6%/28.6% |
| contract_10_GOOSEHEADINSURANCE_INC_04_02_2018.. | 803/497 | 100.0%/100.0% | 14.3%/10.8% |
| contract_11_HarpoonTherapeuticsInc_20200312_1.. | 698/825 | 100.0%/100.0% | 28.2%/40.4% |
| contract_12_ZogenixInc_20190509_10-Q_EX-10_2_.. | 494/637 | 100.0%/100.0% | 27.5%/26.7% |
| contract_13_LIMEENERGYCO_09_09_1999-EX-10-DIS.. | 149/122 | 100.0%/100.0% | 29.5%/52.7% |
| contract_14_ConformisInc_20191101_10-Q_EX-10_.. | 155/33 | 100.0%/100.0% | 18.5%/42.7% |
| contract_15_TodosMedicalLtd_20190328_20-F_EX-.. | 85/40 | 100.0%/100.0% | 49.6%/43.5% |
