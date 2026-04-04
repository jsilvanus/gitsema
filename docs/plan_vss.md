# Phase 36 — Vector Index, Int8 Quantization, and ANN Search

> **Status:** Planned. This document specifies the design for adding approximate nearest-neighbor (ANN) search, int8 scalar quantization of stored vectors, and an optional vector index library to gitsema.

---

## Motivation

gitsema currently computes cosine similarity in pure JavaScript against all stored embedding vectors. This is a full linear scan (O(N) per query). The trade-off is correct for the current scale (~500K blobs), but it will become a bottleneck beyond that:

| Scale | Approx. query time (nomic-embed-text, 768 dims) |
|---|---|
| 50K blobs | ~50ms |
| 500K blobs | ~500ms |
| 5M blobs | ~5s (unacceptable) |

This phase adds:

1. **Int8 scalar quantization** of stored Float32 vectors — reduces storage 4× and cuts cosine computation time ~4×.
2. **Optional ANN index** via `sqlite-vss` or `usearch` — reduces query time from O(N) to O(log N) for large indices.
3. **Schema migration** (v10 → v11) to support both quantized and non-quantized vector storage.
4. **Backward compatibility** — existing Float32 embeddings continue to work; quantized vectors are opt-in per model.

---

## Part 1: Int8 Scalar Quantization

### What it is

Int8 scalar quantization maps each float32 component `x ∈ [min, max]` to an int8 value `q ∈ [-128, 127]` using:

```
scale = (max - min) / 255
q = round((x - min) / scale) - 128
```

Dequantization: `x_approx = (q + 128) * scale + min`

The quantization parameters `(min, scale)` are stored alongside the quantized vector and are used to reconstruct approximate floats for cosine computation.

**Accuracy:** Int8 quantization introduces a small error (~0.5–2% degradation in recall@10 for typical embedding models). For a semantic search tool this is acceptable.

**Storage reduction:** 768-dim float32 = 3072 bytes → int8 = 768 bytes (4× smaller). At 500K blobs: ~1.5 GB → ~375 MB.

### Schema changes (v11)

Add optional quantization columns to `embeddings`:

```sql
ALTER TABLE embeddings ADD COLUMN quantized INTEGER DEFAULT 0;   -- 1 = int8 quantized
ALTER TABLE embeddings ADD COLUMN quant_min REAL;                 -- per-vector minimum
ALTER TABLE embeddings ADD COLUMN quant_scale REAL;               -- per-vector scale
```

When `quantized = 1`, the `vector` column stores `Int8Array` bytes instead of `Float32Array`. `quant_min` and `quant_scale` allow dequantization before cosine computation.

**Affected tables:** `embeddings`, `chunk_embeddings`, `symbol_embeddings`, `commit_embeddings`.

**Schema.ts changes:**
```ts
export const embeddings = sqliteTable('embeddings', {
  // ...existing columns...
  quantized: integer('quantized').default(0),   // 0 = float32, 1 = int8
  quantMin: real('quant_min'),
  quantScale: real('quant_scale'),
}, ...)
```
(Add `real` to the import from `'drizzle-orm/sqlite-core'`.)

### New module: `src/core/embedding/quantize.ts`

```ts
/**
 * Int8 scalar quantization of embedding vectors.
 */

export interface QuantizedVector {
  data: Int8Array
  min: number
  scale: number
}

/**
 * Quantizes a Float32 embedding to Int8 using per-vector min/max scaling.
 */
export function quantizeVector(vector: number[]): QuantizedVector {
  const min = Math.min(...vector)
  const max = Math.max(...vector)
  const range = max - min || 1
  const scale = range / 255
  const data = new Int8Array(vector.length)
  for (let i = 0; i < vector.length; i++) {
    data[i] = Math.round((vector[i] - min) / scale) - 128
  }
  return { data, min, scale }
}

/**
 * Dequantizes an Int8 vector back to approximate float32.
 */
export function dequantizeVector(q: QuantizedVector): number[] {
  const result = new Array<number>(q.data.length)
  for (let i = 0; i < q.data.length; i++) {
    result[i] = (q.data[i] + 128) * q.scale + q.min
  }
  return result
}

/**
 * Serializes a QuantizedVector to a Buffer for SQLite storage.
 */
export function serializeQuantized(q: QuantizedVector): Buffer {
  return Buffer.from(q.data.buffer)
}

/**
 * Deserializes a Buffer from SQLite back to a QuantizedVector.
 */
export function deserializeQuantized(buf: Buffer, min: number, scale: number): QuantizedVector {
  const data = new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  return { data, min, scale }
}
```

### Indexer changes

Add `--quantize` flag to `gitsema index`. When set:
1. Compute the float32 embedding as normal.
2. Call `quantizeVector(embedding)`.
3. Store `quantized=1, quant_min, quant_scale` alongside the int8 `vector` bytes.

The `storeBlob()` function in `blobStore.ts` accepts an optional `quantize?: boolean` option.

### Search changes

In `vectorSearch.ts`, when loading vectors from `embeddings`:
- If `quantized = 1`: deserialize as Int8Array, dequantize to float32 before cosine computation.
- If `quantized = 0` (default): existing float32 path.

This is backward-compatible: existing unquantized embeddings work without change.

---

## Part 2: Vector Index with sqlite-vss / usearch

### Options

| Library | Pros | Cons |
|---|---|---|
| `sqlite-vss` | Integrates natively with SQLite (no separate process) | C++ build step; Windows support unclear; less active |
| `usearch` | Fast, supports int8/float32/binary natively; Node.js bindings | Separate in-memory index; needs serialization for persistence |
| `faiss` | Industry standard; excellent recall | No native Node.js bindings; Python-only officially |
| `hnswlib-node` | HNSW algorithm; good Node.js support | Separate process from SQLite |

**Recommended:** Start with `usearch` (via `usearch` npm package), because:
1. Native Node.js bindings available.
2. Supports int8 quantization natively.
3. Can serialize/deserialize the index to disk as a `.usearch` file in `.gitsema/`.
4. No schema changes required — the vector index is a sidecar file, not in SQLite.

### Index lifecycle

- **Build:** `gitsema index --build-vss` (or automatic after `gitsema index` completes).
- **Location:** `.gitsema/vectors-<model>.usearch` — one index file per model.
- **Persistence:** The index is rebuilt from scratch after `gitsema clear-model` or if the `.usearch` file is missing.
- **Query:** When the `.usearch` file exists and `--vss` is passed to `search`, the ANN index is used instead of linear scan.
- **Fallback:** If the index is stale or missing, fall back to linear scan transparently.

### New CLI flags

```
gitsema index --quantize              # quantize stored vectors to int8
gitsema index --build-vss             # build the usearch ANN index after indexing
gitsema search "query" --vss          # use ANN index for search (requires --build-vss to have run)
gitsema build-vss                     # new command: (re)build the ANN index from current embeddings
```

### New command: `gitsema build-vss [options]`

```
--model <model>      Build index for a specific model (default: configured text+code models)
--quantize           Use int8 quantized vectors in the index
--ef-construction n  HNSW ef_construction parameter (default: 200)
--M n                HNSW M parameter (default: 16)
```

Reads all embeddings for the given model from SQLite, optionally quantizes them, builds a usearch HNSW index, and writes it to `.gitsema/vectors-<model>.usearch`.

### Performance targets

| Query type | N=500K | N=5M |
|---|---|---|
| Linear scan (current) | ~500ms | ~5s |
| HNSW (ANN, k=10, ef=100) | ~5ms | ~10ms |
| Int8 linear scan | ~125ms | ~1.25s |
| Int8 HNSW | ~3ms | ~6ms |

---

## Part 3: Binary / 1-Bit Embeddings (Future)

Binary embeddings (1 bit per dimension) provide extreme compression (~32× vs float32) with moderate accuracy loss (~5–10% recall@10). Models like `mxbai-embed-large` and newer Matryoshka-style models are designed to be binarized.

**Implementation path:** Store as `Uint8Array` with a `quantized=2` flag. Hamming distance computation in JS is very fast (population count via `BigInt` bit operations). Could be added as a second option after int8 is working.

---

## Part 4: Migration Notes

### Schema v11

```sql
ALTER TABLE embeddings ADD COLUMN quantized INTEGER DEFAULT 0;
ALTER TABLE embeddings ADD COLUMN quant_min REAL;
ALTER TABLE embeddings ADD COLUMN quant_scale REAL;
-- Same for chunk_embeddings, symbol_embeddings, commit_embeddings
```

**Backward compatible:** All new columns are nullable or have defaults. Existing float32 rows have `quantized=0, quant_min=NULL, quant_scale=NULL`.

### No forced re-index

Existing embeddings are not re-quantized on migration. Re-quantization only happens when `gitsema index --quantize` is run. The `clear-model` + `index --quantize` workflow allows gradual migration.

---

## Part 5: Configuration Keys

| Config key | Env var | Default | Description |
|---|---|---|---|
| `quantize` | `GITSEMA_QUANTIZE` | `false` | Enable int8 quantization for new embeddings |
| `vssEnabled` | `GITSEMA_VSS` | `false` | Use ANN index for search when available |
| `vssEfSearch` | `GITSEMA_VSS_EF` | `100` | HNSW ef_search parameter (higher = more accurate, slower) |

---

## Part 6: Risk Register Updates

| Risk | Likelihood | Mitigation |
|---|---|---|
| `usearch` Windows build failure | Medium | Use pre-built binaries via optional dependency |
| HNSW index staleness (new blobs indexed but not in ANN index) | High | Auto-detect staleness by comparing blob count in SQLite vs index; fallback to linear scan |
| Int8 recall degradation on specialized models | Low–Medium | Measure recall@10 before/after quantization; expose `--no-quantize` escape hatch |
| Index file size at 5M blobs (HNSW M=16) | ~2.5 GB for float32, ~625 MB for int8 | Acceptable; document size estimate |

---

## Implementation Checklist

- [ ] `src/core/embedding/quantize.ts` — int8 serialize/deserialize/cosine
- [ ] `src/core/db/schema.ts` — add `quantized`/`quant_min`/`quant_scale` columns
- [ ] `src/core/db/sqlite.ts` — schema v11 migration
- [ ] `src/core/indexing/blobStore.ts` — `storeBlob()` quantize option
- [ ] `src/core/indexing/indexer.ts` — `--quantize` flag support
- [ ] `src/core/search/vectorSearch.ts` — dequantize on load
- [ ] `src/cli/commands/buildVss.ts` — new command
- [ ] `src/cli/index.ts` — register `build-vss` command
- [ ] `src/cli/commands/search.ts` — `--vss` flag
- [ ] `src/cli/commands/index.ts` — `--quantize`, `--build-vss` flags
- [ ] Tests: unit tests for `quantize.ts` (round-trip precision)
- [ ] Tests: integration test confirming quantized search recall ≥ 95% of float32
- [ ] `docs/plan_vss.md` — this file (done)
- [ ] `docs/model-stores.md` — update Quantization section (done)
- [ ] `docs/PLAN.md` — add Phase 36 entry
- [ ] npm version minor → 0.35.0

---

*Written 2026-04-04 for Phase 36 planning.*
