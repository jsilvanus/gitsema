# Phase 33 — Multi-Level Hierarchical Indexing

> **Status:** Implemented  
> **Schema version:** 9 (v8 → v9)  
> **Package version:** 0.32.0

---

## Problem Statement

Before Phase 33, gitsema's three chunking strategies were mutually exclusive:

| CLI flag | `embeddings` table | `chunks`/`chunk_embeddings` | `symbols`/`symbol_embeddings` |
|---|---|---|---|
| `--chunker file` (default) | ✅ one row per blob | ❌ | ❌ |
| `--chunker fixed` | ❌ (blob record only) | ✅ per window | ❌ |
| `--chunker function` | ❌ (blob record only) | ✅ per named decl | ✅ enriched embedding |

When a user indexed with `--chunker function`, the `embeddings` table was **never populated**. This silently broke:

- `search` (returns nothing from whole-file vectors)
- `evolution` / `concept-evolution` (needs whole-file vectors for drift tracking)
- `clusters` / `cluster-diff` / `cluster-timeline` (k-means over `embeddings` table)
- `dead-concepts`, `impact`, `semantic-diff` (all query `embeddings`)

The root cause was `indexer.ts:202`:
```ts
const useChunking = chunkerStrategy !== 'file'
```
This flag caused the chunking branch to call `storeBlobRecord` (no embedding) instead of `storeBlob` (with embedding), and skip the `embeddings` table entirely.

---

## Architecture: Three Indexing Levels

### Level 1 — Whole-file blob embeddings (always stored)

**Table:** `embeddings`  
**Granularity:** One embedding per unique blob hash.  
**Captures:** "What does this file do overall?" — holistic semantics.

**Use cases:** Broad concept search, `evolution`, `clusters`, `dead-concepts`, `impact`, `semantic-diff`.

**Fix implemented:** The `useChunking` branch now always computes and stores a whole-file embedding via `storeBlob` **before** running the chunk loop. If the embedding fails (e.g. provider error), it falls back to `storeBlobRecord` to preserve the blob record without a Level-1 embedding. The `--chunker file` (default) path was already correct.

### Level 2a — Fixed-window chunk embeddings

**Table:** `chunks` + `chunk_embeddings`  
**Granularity:** Overlapping character windows (~1500 chars), line-boundary aligned.  
**Captures:** Dense passage retrieval; best for RAG and prose files without clear structure.

**Activated by:** `--chunker fixed` (explicit) or fallback chain (when whole-file exceeds model context).

### Level 2b — Symbol-level enriched embeddings

**Table:** `symbols` + `symbol_embeddings`  
**Granularity:** Named declarations extracted by tree-sitter (functions, classes, methods, impl blocks, etc.).  
**Captures:** Precise semantic identity of a named code unit. Embedding text includes file path, symbol name, kind, and source lines.

**Activated by:** `--chunker function`.  

**New in Phase 33:** `symbols.chunk_id` (nullable) links each symbol to its source chunk row in `chunks`. The `chunkId` returned by `storeChunk()` is now forwarded to `storeSymbol()`, closing the gap between the two tables.

### Level 3 — Module/directory centroid embeddings

**Table:** `module_embeddings`  
**Granularity:** One centroid per directory path (e.g. `src/core/embedding`), computed as the arithmetic mean of all Level-1 blob vectors in that directory.  
**Captures:** "What does this module do?" — coarse, cross-file concept tracking.

**Update strategy:**
- **Inline (incremental):** After every Level-1 embedding is stored, the indexer reads the existing module centroid (if any), computes a running arithmetic mean, and upserts the result. Controlled by `IndexerOptions.computeModuleEmbedding` (defaults to `true`).
- **Batch recalculation:** `gitsema update-modules` deletes all module embeddings and recomputes them from scratch using all stored Level-1 embeddings. Equivalent to a full rebuild of Level 3.

**Use cases:** Coarse module-level search (`--level module`), future hierarchical cascade (query module → narrow to blobs → narrow to symbols).

**Why not line-level?** Individual lines lack syntactic context; embedding them produces near-random noise and costs 100–1000× more per repo.  
**Why not project-level centroid?** Trivially computable on demand (mean of all blob vectors); no need to persist.

---

## Schema Changes (v8 → v9)

### New table: `module_embeddings`

```sql
CREATE TABLE IF NOT EXISTS module_embeddings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  module_path TEXT    NOT NULL UNIQUE,   -- e.g. 'src/core/embedding'
  model       TEXT    NOT NULL,
  dimensions  INTEGER NOT NULL,
  vector      BLOB    NOT NULL,          -- Float32 serialized
  blob_count  INTEGER NOT NULL,          -- blobs averaged into this centroid
  updated_at  INTEGER NOT NULL           -- Unix ms timestamp of last update
);
```

### New column: `symbols.chunk_id`

```sql
ALTER TABLE symbols ADD COLUMN chunk_id INTEGER;
-- nullable FK referencing chunks(id); no constraint enforced in SQLite ALTER
```

SQLite does not support adding a `FOREIGN KEY` constraint via `ALTER TABLE`. The FK relationship is enforced at application level — `storeSymbol()` only writes `chunkId` values returned by `storeChunk()`.

---

## Indexer Changes (`src/core/indexing/indexer.ts`)

### New `IndexerOptions` field

```ts
computeModuleEmbedding?: boolean  // default true
```

Controls whether inline Level-3 module centroid updates are performed during indexing. Set to `false` to skip module updates (useful for testing or when using `update-modules` exclusively).

### New `IndexStats` field

```ts
moduleEmbeddings: number  // count of module centroid rows updated
```

### Chunking branch fix

Before Phase 33 (pseudocode):
```
storeBlobRecord(...)       // blob + path, NO embedding
for each chunk:
  storeChunk(...)
  storeSymbol(...)         // no chunkId propagated
```

After Phase 33:
```
wholeEmbedding = embed(text)   // Level-1 embedding
if succeeded:
  storeBlob(...)               // blob + embedding + path (single call)
  updateModuleCentroid(dir, wholeEmbedding)
else:
  storeBlobRecord(...)         // fallback: blob + path only
for each chunk:
  chunkId = storeChunk(...)
  storeSymbol(..., chunkId)   // FK propagated
```

---

## New CLI Command: `update-modules`

```
gitsema update-modules
```

Recalculates all module centroid embeddings from scratch by grouping stored whole-file embeddings by directory and computing arithmetic means. Equivalent to running `--since all` indexing for Level 3 only.

**When to use:**
- After an index run with `computeModuleEmbedding: false`
- After importing an existing index (DB migration from pre-Phase 33)
- After changing the embedding model (run `gitsema index --since all` then `update-modules`)

**Output:** `Updated N module embeddings`

---

## Search Changes (`search` command)

### New `--level` flag

```
gitsema search <query> --level <file|chunk|symbol|module>
```

| Level | Queries | Default |
|---|---|---|
| `file` (default) | `embeddings` (whole-file) | ✅ |
| `chunk` | `chunk_embeddings` + `embeddings` | |
| `symbol` | `symbol_embeddings` + `embeddings` | |
| `module` | `module_embeddings` | |

When `--level module`, results have `modulePath` set and `paths: [modulePath]`. These are directory-level results, not file-level.

The existing `--chunks` flag maps to `--level chunk` (retained for backward compatibility).

---

## Performance Considerations

### Embedding cost

Enabling `--chunker function` or `--chunker fixed` now costs one extra embedding API call per blob (the whole-file Level-1 embedding). For a 10K-blob repo at 50ms per embedding call and concurrency=4, this adds ~125 seconds. The cost is already throttled by the existing `p-limit` concurrency wrapper.

**Escape hatch:** Pass `computeModuleEmbedding: false` (programmatic API) to skip both the Level-1 and module updates when only chunk/symbol embeddings are needed.

### Database size

With 768-dimensional embeddings (3KB per vector):

| Level | Blobs | Est. rows | Est. size |
|---|---|---|---|
| L1 whole-file | 100K | 100K | ~300 MB |
| L2 symbols (avg 5/blob) | 100K | 500K | ~1.5 GB |
| L3 modules (avg 20 blobs/dir) | 100K | 5K | ~15 MB |

The L3 overhead is negligible. L2 is the dominant cost; it's only incurred when `--chunker function` is chosen.

### Search performance

Pure-JS cosine scan at 100K blobs takes ~50ms. At 500K, it becomes noticeable. The hierarchical cascade pattern (query L3 modules → filter L1 blobs to top modules → query L2 symbols within those blobs) reduces scan cost by 10–100× and is the intended next phase once module search is validated.

---

## Files Changed

| File | Change |
|---|---|
| `src/core/db/schema.ts` | Added `moduleEmbeddings` table; added `chunkId` to `symbols` |
| `src/core/db/sqlite.ts` | Schema v9 migration; `module_embeddings` in `initTables` |
| `src/core/indexing/blobStore.ts` | `storeModuleEmbedding`, `getModuleEmbedding`, `getAllBlobEmbeddingsWithPaths`, `deleteAllModuleEmbeddings`; `chunkId` in `storeSymbol` |
| `src/core/indexing/indexer.ts` | Level-1 whole-file embedding in chunking branch; module centroid updates; `chunkId` propagation |
| `src/core/search/vectorSearch.ts` | `searchModules` option; module candidate pool; module result mapping |
| `src/core/models/types.ts` | `modulePath?` on `SearchResult` |
| `src/cli/commands/updateModules.ts` | New `update-modules` command |
| `src/cli/commands/search.ts` | `--level` flag mapping |
| `src/cli/index.ts` | Register `update-modules`; `--level` option on `search` |
| `tests/moduleEmbeddings.test.ts` | New integration tests for Level-3 module embeddings |
