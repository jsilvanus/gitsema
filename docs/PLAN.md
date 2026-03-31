# gitsema — Refined Development Plan

> A Git-aware semantic search engine that treats code history as a time-indexed semantic dataset.

## Vision

`gitsema` is not just semantic search over Git. It is a content-addressed semantic index synchronized with Git's object model. Blob hashes are the unit of identity. Embeddings are immutable artifacts. The CLI is the primary interface.

---

## Guiding principles

- **Git is the source of truth.** Never maintain state that Git already knows.
- **Blob-first.** Every operation pivots on `blob_hash`, not file path or commit.
- **Immutable embeddings.** Computed once per blob, never recomputed.
- **One deliverable per phase.** Each phase ends with working, usable software.
- **CLI-first, MCP later.** The MCP layer wraps a mature tool, not a prototype.

---

## Architecture overview

```
git repo
   ↓
[ Git Walker ]          git rev-list --objects --all
   ↓                    git cat-file blob <hash>
[ Deduper ]             skip already-indexed blobs
   ↓
[ Embedding Engine ]    EmbeddingProvider interface
   ↓
[ SQLite + vectors ]    Drizzle ORM, blob-addressed schema
   ↓
[ CLI ]                 index · search · first-seen · evolution
   ↓ (phase 11)
[ MCP layer ]           semantic_search · search_history · first_seen
```

---

## Project structure

```
gitsema/
  src/
    cli/
      index.ts
      commands/
        index.ts
        search.ts
        firstSeen.ts
        evolution.ts
        status.ts

    core/
      git/
        revList.ts         -- git rev-list wrapper
        showBlob.ts        -- git cat-file blob wrapper
        commitMap.ts       -- commit → blob relationships

      indexing/
        indexer.ts
        blobStore.ts
        deduper.ts

      embedding/
        provider.ts        -- EmbeddingProvider interface
        local.ts           -- Ollama implementation
        http.ts            -- generic HTTP implementation

      search/
        vectorSearch.ts
        ranking.ts

      db/
        schema.ts
        sqlite.ts

      models/
        types.ts

    utils/
      logger.ts
      concurrency.ts

  package.json            -- ESM, type: "module"
  tsconfig.json
  README.md
```

---

## Phases

### Phase 1 — Foundation

**Goal:** Everything compiles, nothing runs yet.

Establish the project scaffold: ESM `package.json`, TypeScript config, directory
structure, and the canonical `types.ts`. Define core domain types up front so
later phases never need to negotiate their shapes:

```ts
type BlobHash   = string  // SHA-1 hex
type CommitHash = string
type Embedding  = number[]

interface BlobRecord {
  blobHash: BlobHash
  size: number
  indexedAt: number
}

interface SearchResult {
  blobHash: BlobHash
  paths: string[]
  score: number
  firstCommit?: CommitHash
  firstSeen?: number
}
```

Wire up the SQLite connection via Drizzle ORM. Define the minimal Phase 1 schema:

```ts
// blobs: known content
// embeddings: vector per blob
// paths: one row per (blob, path) pair — a blob may appear at many paths
```

**Deliverable:** `pnpm build` succeeds. Database opens. Schema is migrated.

---

### Phase 2 — Git walking

**Goal:** Stream all blobs from a repo without touching the embedding engine.

Implement the two Git primitives that underpin everything:

- `revList.ts` — wraps `git rev-list --objects --all`, parses blob hash + path
  pairs from stdout line by line as a Node.js `Readable` stream.
- `showBlob.ts` — wraps `git cat-file blob <hash>`, returns content as a
  `Buffer`. Apply a size cap here (default 200 KB) so it never becomes a problem
  later.

Build a `Walker` that composes these: iterates all blobs in the repo, yields
`{ blobHash, path, content }` objects. At this stage it just logs what it finds.

Key decision: the walker must be streaming, not batch. Large repos have hundreds
of thousands of blobs. Buffering them in memory before processing is not an option.

**Deliverable:** `gitsema status` prints blob count and total repo size.

---

### Phase 3 — Embedding system

**Goal:** A swappable embedding abstraction with a working local implementation.

Define a strict interface that all providers must satisfy:

```ts
export interface EmbeddingProvider {
  embed(text: string): Promise<Embedding>
  embedBatch?(texts: string[]): Promise<Embedding[]>
  readonly dimensions: number
  readonly model: string
}
```

Implement:

- `local.ts` — Ollama via `http://localhost:11434/api/embeddings`. Model is
  configurable (default `nomic-embed-text`). Dimensions are read from the first
  response so the schema can self-configure.
- `http.ts` — Generic HTTP provider for any OpenAI-compatible embeddings
  endpoint. Useful for self-hosted alternatives.

This phase is intentionally narrow. Do not integrate the provider into the
indexer yet. The only goal is confirming the interface is clean and the Ollama
call returns a correctly shaped `number[]`.

The `embeddings` table schema depends on `dimensions`, which varies by model.
Store vectors as `BLOB` (raw `Float32Array` bytes). Add a `model` column so you
can detect when the indexed model no longer matches the configured provider.

**Deliverable:** `gitsema status` reports the configured provider and model.
A standalone `embed.ts` script embeds a test string and prints the vector length.

---

### Phase 4 — Indexing

**Goal:** `gitsema index` works end-to-end.

Compose the walker, deduper, embedding engine, and database writes into a
single `Indexer` class. The processing pipeline per blob:

1. Check `blobs` table — if `blobHash` already present, skip entirely.
2. Read content via `showBlob`.
3. Generate embedding via provider.
4. Write to `blobs`, `embeddings`, `paths` in a single transaction.

The deduper (step 1) is the most important optimization in the entire project.
A blob that appears across 500 commits is embedded exactly once. On a real
codebase this cuts embedding calls by 80–95%.

Add basic progress output: blobs seen / new / skipped / failed, with a running
estimate of time remaining.

**Deliverable:** `gitsema index` runs to completion on a real repo. The
database is populated and queryable with raw SQL.

---

### Phase 5 — Search  ·  *MVP deliverable*

**Goal:** `gitsema search "query"` returns ranked results.

The search pipeline:

1. Embed the query string using the configured provider.
2. Load all stored embeddings from the database.
3. Compute cosine similarity between the query vector and each blob vector.
4. Sort descending by score, take top-k (default 10).
5. Join against `paths` to resolve file paths.
6. Print results: score · path · blob hash (short).

Cosine similarity in pure JS is fast enough for tens of thousands of blobs.
If the database grows beyond ~500k blobs, revisit with a vector index (Phase 9
or beyond). Do not prematurely optimize.

Example output:

```
0.921  src/auth/oauth.ts          [a3f9c2d]
0.887  src/auth/session.ts        [b19e4a1]
0.863  lib/middleware/jwt.ts      [c02d8f7]
```

**Deliverable:** A fully working CLI. Index any Git repo, search it
semantically. This is the point where the tool is genuinely useful for daily
development work, even without any commit awareness.

---

### Phase 6 — Commit mapping

**Goal:** The database understands Git history.

Extend the schema with two new tables:

```ts
commits: {
  commitHash: CommitHash   PRIMARY KEY
  timestamp:  number       -- Unix epoch
  message:    string       -- first line only
}

blobCommits: {
  blobHash:   BlobHash
  commitHash: CommitHash
}
```

Extend the indexer to populate these during `gitsema index`. For each commit
visited during `rev-list`, record it in `commits` and create `blobCommits` rows
linking blobs to the commits they appear in.

No new CLI commands in this phase. The work is entirely in the data model. This
is intentional — build the foundation before the queries that depend on it.

Note on volume: `blobCommits` can grow large (one row per blob per commit it
appears in). This is expected. Add a covering index on `(blobHash, commitHash)`
for the queries that Phase 7 will need.

**Deliverable:** After re-indexing, `commits` and `blobCommits` are populated.
Verify with raw SQL that `first-seen` queries are possible before building the CLI.

---

### Phase 7 — Time-aware queries  ·  *Phase 2 deliverable*

**Goal:** The index understands time.

Add three new capabilities:

**`gitsema first-seen "oauth"`**
Search blobs semantically → for each result, find the earliest commit in
`blobCommits` → sort by timestamp → show when that concept first appeared in
the codebase and in which file.

**`gitsema search "auth" --recent`**
Combine vector similarity with a recency boost. Score formula:

```
finalScore = α × cosineSimilarity + (1 − α) × recencyScore
```

where `recencyScore` normalizes commit timestamps to [0, 1] and `α` defaults
to 0.8. Expose `--alpha` to let users tune the balance.

**`gitsema search "middleware" --before 2023-01-01`**
Filter the candidate set to blobs whose earliest commit predates the given
timestamp before computing similarity. Also support `--after`.

**Deliverable:** All three commands work. You can now ask the codebase
questions with a temporal dimension, which is the core differentiator of
`gitsema` over conventional semantic search tools.

---

### Phase 8 — File-type-aware embedding models

**Goal:** Use the optimal embedding model per content type — a code-aware model for source files and a text model for documentation and prose.

Different content types benefit from different embedding models. Source code has a highly structured, syntax-rich vocabulary that is captured more faithfully by code-aware models (e.g. `nomic-embed-code`). Prose documentation benefits from general-purpose text models (e.g. `nomic-embed-text`). Routing each blob to its best-fit model improves search precision for both use cases without requiring any additional infrastructure.

**New environment variables**

| Variable | Default | Purpose |
|---|---|---|
| `GITSEMA_TEXT_MODEL` | `nomic-embed-text` | Model used for prose, documentation, and unknown file types |
| `GITSEMA_CODE_MODEL` | (same as text model) | Model used for source code files |

When `GITSEMA_CODE_MODEL` equals `GITSEMA_TEXT_MODEL` (the default), a single provider is used — the behaviour is identical to Phase 3 and fully backward-compatible.

**New modules**

- `src/core/embedding/fileType.ts` — classifies a file path as `'code'`, `'text'`, or `'other'` based on extension. Defines `CODE_EXTENSIONS` and `TEXT_EXTENSIONS` sets.
- `src/core/embedding/router.ts` — `RoutingProvider` that wraps a text provider and a code provider. `providerForFile(path)` returns the correct provider; `embed(text)` routes to the text provider (search queries are prose).

**Schema change**

Add a nullable `file_type` column to the `embeddings` table. Records the category (`code` / `text` / `other`) that was active when the embedding was produced. This makes it possible to detect mismatches if a blob is re-indexed with a different routing policy.

**Indexer change**

`IndexerOptions` gains an optional `codeProvider` field. When present, the indexer uses `RoutingProvider` to select the active model per blob before calling `embed()`. The `model` column in `embeddings` correctly reflects which model was actually used for each blob.

**Search query handling**

Search queries have no file path. `RoutingProvider.embed()` always delegates to the text provider. This ensures that natural-language queries are embedded with the same model used for prose files, which is the correct semantic space for matching against documentation.

**Deliverable:** `GITSEMA_CODE_MODEL=nomic-embed-code gitsema index` indexes code files with the code model and documentation with the text model. `gitsema status` reports both configured models when they differ. The `scripts/embed.ts` script accepts an optional file path argument and shows which model was selected for that file type.

---

### Phase 9 — Performance

**Goal:** Practical daily use on large repositories.

Three independent improvements, each mergeable separately:

**Incremental indexing**

Track which commits have been fully processed in a new `indexedCommits` table.
`gitsema index --since HEAD~100` (or `--since <hash>`) processes only new
commits, skipping blobs already in the database. On subsequent runs of
`gitsema index` with no flag, default to indexing only since the last indexed
commit.

**Parallel embedding**

Wrap embedding calls with `p-limit` for configurable concurrency (default 4).
Add batching where the provider supports `embedBatch`. Measure throughput
improvement; target 4–8x speedup on a cold index.

**File filtering**

```
--ext .ts,.js,.py      only index these extensions
--max-size 200kb       skip blobs larger than this
--exclude node_modules,dist,vendor
```

Filtering happens in the walker before any content is read or embeddings
are generated — it is purely a path-based check.

**Deliverable:** Re-indexing a large monorepo (e.g. 10k+ unique blobs) runs
in under 5 minutes on commodity hardware with a local Ollama instance.

---

### Phase 10 — Smarter semantics

**Goal:** Better results without changing the core architecture.

**Pluggable chunking**

Whole-file indexing works well for most cases but loses precision on large
files. Add an optional `--chunker` flag accepting a strategy name:

- `file` (default) — index the whole file as one blob
- `function` — split on function/class boundaries using tree-sitter
- `fixed` — fixed-size windows with overlap

Chunks are stored as separate embeddings with a `chunkOf` foreign key back to
the blob. Search results show the chunk's line range alongside the file path.

The chunker is pluggable by design. Resist adding more than `file` and
`function` in this phase.

**Improved ranking**

Combine three signals into a single score:

| Signal | Weight | Notes |
|---|---|---|
| Vector similarity | 0.7 | cosine, primary signal |
| Recency | 0.2 | normalized timestamp |
| Path relevance | 0.1 | keyword match between query and path |

Expose weights as `--weight-vector`, `--weight-recency`, `--weight-path`.

**Result grouping**

`gitsema search "retry logic" --group file` collapses multiple results from
the same file into one entry showing the top-scoring chunk. Also support
`--group module` (by directory) and `--group commit`.

**Deliverable:** Search results on a mature codebase are noticeably more
precise. The chunker integration does not regress performance on whole-file
indexing.

---

### Phase 11 — Advanced features + MCP

**Goal:** The full platform.

**`gitsema evolution src/auth/oauth.ts`**

Track how a file's semantic content has drifted over time. For each unique
blob hash the file has had, retrieve its embedding. Plot (or print) cosine
distance between successive versions. Large jumps indicate rewrites; gradual
drift indicates organic growth. Output is a timeline of (commit, date, distance
from previous, distance from origin).

**Semantic diff**

`gitsema diff HEAD~1 HEAD -- src/auth/oauth.ts`

Compare the embeddings of two versions of a file. Report cosine distance and,
optionally, the nearest neighbors of each version to characterize what each
version is "about" semantically.

**Hybrid search**

`gitsema search "oauth token" --hybrid`

Combine vector similarity (semantic) with BM25 keyword matching (lexical).
Implement BM25 in SQLite using FTS5. The final score is a weighted combination
of both signals. Hybrid search significantly improves precision when the query
contains specific technical terms that may not be well-represented by the
embedding alone.

**MCP layer**

Wrap the CLI as a set of MCP tools, exposing `gitsema` to Claude Code and any
other MCP client:

```ts
semantic_search(query: string, options?: SearchOptions): SearchResult[]
search_history(query: string, options?: TimeOptions): SearchResult[]
first_seen(query: string): FirstSeenResult[]
evolution(path: string): EvolutionResult[]
```

The MCP server is a thin adapter over the existing CLI logic — it shares the
same core modules and SQLite database. It does not duplicate logic.

**Deliverable:** `gitsema` is a complete semantic intelligence layer for Git
repositories, accessible both as a CLI tool for developers and as an MCP
server for AI-assisted workflows.

---

## Key technical decisions

| Decision | Choice | Rationale |
|---|---|---|
| Unit of identity | `blob_hash` | Immutable, content-addressed, dedup is free |
| Vector storage | `BLOB` (Float32Array bytes) | No extension required, portable |
| ORM | Drizzle | Lightweight, ESM-native, SQL-close |
| Similarity | Cosine in JS | Fast enough up to ~500k blobs |
| Embedding provider | Ollama (local) | Zero cost, GDPR-clean, swappable |
| CLI framework | `commander` or `citty` | Composable, scriptable |
| Concurrency | `p-limit` | Simple, no worker thread overhead |

## Risk register

| Risk | Mitigation |
|---|---|
| Repo explosion (millions of blobs) | Filters (Phase 9), vector index (post-Phase 11) |
| Embedding cost / latency | Blob dedup (Phase 4), batching (Phase 9) |
| Model change invalidates index | `model` column on embeddings, re-index detection |
| SQLite write contention | Single writer pattern, WAL mode |
| Slow cosine search at scale | KNN index with `sqlite-vss` or `pgvector` migration |
