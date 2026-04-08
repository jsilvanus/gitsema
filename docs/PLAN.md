# gitsema — Refined Development Plan

> A Git-aware semantic search engine that treats code history as a time-indexed semantic dataset.

---

## Table of Contents

| Section | Line |
|---|---:|
| [Table of Contents](#table-of-contents) | 7 |
| [Vision](#vision) | 70 |
| [Guiding principles](#guiding-principles) | 76 |
| [Architecture overview](#architecture-overview) | 86 |
| [Project structure](#project-structure) | 106 |
| [Section I - Phases](#section-i-phases) | 158 |
|   [Phase 1 — Foundation](#phase-1-—-foundation) | 160 |
|   [Phase 2 — Git walking](#phase-2-—-git-walking) | 202 |
|   [Phase 3 — Embedding system](#phase-3-—-embedding-system) | 226 |
|   [Phase 4 — Indexing](#phase-4-—-indexing) | 264 |
|   [Phase 5 — Search  ·  *MVP deliverable*](#phase-5-—-search-·-mvp-deliverable) | 290 |
|   [Phase 6 — Commit mapping](#phase-6-—-commit-mapping) | 323 |
|   [Phase 7 — Time-aware queries  ·  *Phase 2 deliverable*](#phase-7-—-time-aware-queries-·-phase-2-deliverable) | 360 |
|   [Phase 8 — File-type-aware embedding models](#phase-8-—-file-type-aware-embedding-models) | 393 |
|   [Phase 9 — Performance](#phase-9-—-performance) | 431 |
|   [Phase 10 — Smarter semantics](#phase-10-—-smarter-semantics) | 469 |
|   [Phase 11 — Advanced features + MCP](#phase-11-—-advanced-features-mcp) | 514 |
|   [Phase 11b — Content access and semantic concept tracking](#phase-11b-—-content-access-and-semantic-concept-tracking) | 585 |
| [Key technical decisions](#key-technical-decisions) | 702 |
| [Risk register](#risk-register) | 714 |
|   [Phase 12 — CLI consolidation & robust per-file indexing](#phase-12-—-cli-consolidation-robust-per-file-indexing) | 726 |
|   [Recent progress (snapshot: 2026-04-01)](#recent-progress-snapshot-2026-04-01) | 756 |
|   [Phase 13 — Standalone model server for embeddings](#phase-13-—-standalone-model-server-for-embeddings) | 772 |
|   [Phase 14 — Infrastructure, tooling, and maintenance](#phase-14-—-infrastructure-tooling-and-maintenance) | 855 |
|   [Phase 14b — Search result deduplication](#phase-14b-—-search-result-deduplication) | 912 |
|   [Phase 15 — Branch awareness](#phase-15-—-branch-awareness) | 946 |
|   [Phase 16 — Remote-repository indexing (server-managed clone, RAM-backed working tree, persistent DB)](#phase-16-—-remote-repository-indexing-server-managed-clone-ram-backed-working-tree-persistent-db) | 1018 |
|   [Phase 17 — Remote-indexing hardening and SSH support](#phase-17-—-remote-indexing-hardening-and-ssh-support) | 1276 |
|   [Phase 18 — Reliability, tests, and query caching](#phase-18-—-reliability-tests-and-query-caching) | 1347 |
|   [Phase 19 — Smarter chunking, semantic blame & symbol-level embeddings](#phase-19-—-smarter-chunking-semantic-blame-symbol-level-embeddings) | 1361 |
|   [Phase 20 — Dead-concept detection & refactor impact analysis](#phase-20-—-dead-concept-detection-refactor-impact-analysis) | 1426 |
|   [Phase 21 — Semantic clustering & concept graph](#phase-21-—-semantic-clustering-concept-graph) | 1439 |
|   [Phase 22 — Temporal cluster diff](#phase-22-—-temporal-cluster-diff) | 1452 |
|   [Phase 23 — Cluster timeline](#phase-23-—-cluster-timeline) | 1465 |
|   [Phase 24 — Enhanced cluster labeling](#phase-24-—-enhanced-cluster-labeling) | 1479 |
|   [Phase 25 — Interactive HTML visualizations](#phase-25-—-interactive-html-visualizations) | 1493 |
|   [Phase 26 — CLI naming consolidation & conceptual diff](#phase-26-—-cli-naming-consolidation-conceptual-diff) | 1508 |
|   [Phase 27 — Semantic change-point detection](#phase-27-—-semantic-change-point-detection) | 1549 |
|   [Phase 28 — Persistent configuration management](#phase-28-—-persistent-configuration-management) | 1609 |
|   [Phase 29 — Automated indexing via Git hooks](#phase-29-—-automated-indexing-via-git-hooks) | 1636 |
|   [Phase 30 — Commit message semantic indexing](#phase-30-—-commit-message-semantic-indexing) | 1652 |
|   [Phase 31 — Semantic concept authorship ranking](#phase-31-—-semantic-concept-authorship-ranking) | 1703 |
|   [Phase 32 — Branch and merge awareness](#phase-32-—-branch-and-merge-awareness) | 1753 |
|   [Phase 33 — Multi-level hierarchical indexing](#phase-33-—-multi-level-hierarchical-indexing) | 1814 |
|   [Phase 34 — Feature adoption & cross-cutting improvements](#phase-34-—-feature-adoption-cross-cutting-improvements) | 1870 |
|   [Phase 35 — Multi-model DB, per-command model flags, clear-model, multi-model search](#phase-35-—-multi-model-db-per-command-model-flags-clear-model-multi-model-search) | 1908 |
|   [Phase 36 — Vector Index (VSS), Int8 Quantization, ANN Search](#phase-36-—-vector-index-vss-int8-quantization-ann-search) | 1946 |
|   [Phase 37 — Quick Wins: Selective Indexing, Code-to-Code Search, Negative Examples, Result Explanation](#phase-37-—-quick-wins-selective-indexing-code-to-code-search-negative-examples-result-explanation) | 2020 |
|   [Phase 38 — Medium Effort: Documentation Gap Analysis, Semantic Bisect, GC, Boolean Queries](#phase-38-—-medium-effort-documentation-gap-analysis-semantic-bisect-gc-boolean-queries) | 2045 |
|   [Phase 39 — Analysis Features: Contributor Profiles, Refactoring, Lifecycle, CI Diff](#phase-39-—-analysis-features-contributor-profiles-refactoring-lifecycle-ci-diff) | 2070 |
|   [Phase 40 — Visualization & Scale: Codebase Map, Temporal Heatmap, Remote Index, Cherry-Pick](#phase-40-—-visualization-scale-codebase-map-temporal-heatmap-remote-index-cherry-pick) | 2095 |
|   [Phase 41 — Multi-Repo Unified Index](#phase-41-—-multi-repo-unified-index) | 2131 |
|   [Phase 42 — IDE / LSP Integration](#phase-42-—-ide--lsp-integration) | 2149 |
|   [Phase 43 — Security Pattern Detection](#phase-43-—-security-pattern-detection) | 2163 |
|   [Phase 44 — Codebase Health Timeline](#phase-44-—-codebase-health-timeline) | 2177 |
|   [Phase 45 — Technical Debt Scoring](#phase-45-—-technical-debt-scoring) | 2192 |
|   [Phase 46 — Evolution Alerts and Commit URL Construction](#phase-46-—-evolution-alerts-and-commit-url-construction) | 2209 |
|   [Phase 47 — Richer Indexing Progress, Embed Latency Stats, and Incremental-by-Default Messaging](#phase-47-—-richer-indexing-progress-embed-latency-stats-and-incremental-by-default-messaging) | 2225 |
| [Section II - Next?](#section-ii-next) | 2635 |
|   [Planned Phases (71+)](#planned-phases-71) | 2638 |
|   [Long-Term Investments](#long-term-investments-phase-71) | 2694 |

---

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

## Section I - Phases

### Phase 1 — Foundation

**Version:** implemented in 0.0.1

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

**Version:** implemented in 0.0.1

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

**Version:** implemented in 0.0.1

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

**Version:** implemented in 0.0.1

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

**Version:** implemented in 0.0.1

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

**Version:** implemented in 0.0.1

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

**Version:** implemented in 0.0.1

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

**Version:** implemented in 0.0.1

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

**Version:** implemented in 0.0.1

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

**Version:** implemented in 0.0.1

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

**Version:** implemented in 0.0.1

**Goal:** The full platform.

**`gitsema evolution src/auth/oauth.ts`**

Track how a file's semantic content has drifted over time. For each unique
blob hash the file has had, retrieve its embedding. Plot (or print) cosine
distance between successive versions. Large jumps indicate rewrites; gradual
drift indicates organic growth. Output is a timeline of (commit, date, distance
from previous, distance from origin).

`--dump [file]` outputs a structured JSON representation of the full timeline
to stdout (if no file given) or to a file while still printing the human-readable
summary to stdout. The JSON shape is:

```json
{
  "path": "src/auth/oauth.ts",
  "versions": 4,
  "threshold": 0.3,
  "timeline": [
    { "index": 0, "date": "2021-03-15", "blobHash": "...", "commitHash": "...",
      "distFromPrev": 0, "distFromOrigin": 0, "isOrigin": true, "isLargeChange": false }
  ],
  "summary": { "largeChanges": 1, "maxDistFromPrev": 0.412, "totalDrift": 0.401 }
}
```

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
index(options?: IndexOptions): IndexStats
```

The MCP server is a thin adapter over the existing CLI logic — it shares the
same core modules and SQLite database. It does not duplicate logic.

**Deliverable:** `gitsema` is a complete semantic intelligence layer for Git
repositories, accessible both as a CLI tool for developers and as an MCP
server for AI-assisted workflows.

---

### Phase 11b — Content access and semantic concept tracking

**Version:** implemented in 0.0.1

**Goal:** Make the index richer for agent consumption; add concept-level evolution across history.

**`--include-content` on `evolution --dump`**

Extend the JSON dump produced by `gitsema evolution <path> --dump` with an optional
`--include-content` flag. When set, each timeline entry gains a `content` field
holding the full stored text of that blob version as it was recorded in the FTS5
index. This gives agents the raw file at each historical snapshot without any
extra tooling:

```json
{
  "index": 1,
  "date": "2022-06-10",
  "blobHash": "b19e4a1...",
  "content": "// full file text here...",
  "distFromPrev": 0.145,
  ...
}
```

`content` is `null` when the blob was indexed before the FTS5 table was introduced
(i.e. before Phase 11).

**`getBlobContent(blobHash)`**

New export from `src/core/indexing/blobStore.ts`. Retrieves the stored text for a
given blob hash from the FTS5 `blob_fts` table. Returns `undefined` when the blob
has no stored text. Used by both the CLI dump and the MCP tools.

**MCP `evolution` tool — `include_content` parameter**

The `evolution` MCP tool gains an `include_content: boolean` parameter (only
meaningful when `structured: true`). When enabled, each timeline entry in the
returned JSON includes the full stored file text, identical to the CLI flag above.

**`gitsema concept-evolution <query>`**

Semantic concept evolution: rather than tracking a single file, trace how a
*concept* (e.g. `"authentication"`) evolved across the entire codebase history.

Algorithm:

1. Embed the query string.
2. Score all indexed blobs by cosine similarity and select the top-k (default 50).
3. For each selected blob, resolve its earliest commit timestamp and file paths.
4. Sort the result set chronologically (oldest-first).
5. Compute `distFromPrev` between consecutive entries in the timeline.

Output is a timeline showing when each semantically related blob first appeared,
what file it lived in, how similar it is to the concept query, and how much the
code changed between successive related blobs:

```
2021-03-15  src/auth/session.ts                          [a3f9c2d]  score=0.892  dist_prev=0.000  (origin)
2021-06-22  src/auth/oauth.ts                            [b19e4a1]  score=0.912  dist_prev=0.145
2022-09-10  src/auth/jwt.ts                              [c02d8f7]  score=0.872  dist_prev=0.231  ← large change
```

Flags:

| Flag | Default | Purpose |
|---|---|---|
| `-k, --top <n>` | `50` | How many top-matching blobs to include |
| `--threshold <n>` | `0.3` | Distance threshold for flagging large changes |
| `--dump [file]` | — | Emit structured JSON to stdout or a file |
| `--include-content` | `false` | Add stored file text to each JSON entry (with `--dump`) |

The `--dump` JSON shape:

```json
{
  "query": "authentication",
  "entries": 12,
  "threshold": 0.3,
  "timeline": [
    { "index": 0, "date": "2021-03-15", "blobHash": "...", "commitHash": "...",
      "paths": ["src/auth/session.ts"], "score": 0.892,
      "distFromPrev": 0, "isOrigin": true, "isLargeChange": false }
  ],
  "summary": { "largeChanges": 2, "maxDistFromPrev": 0.231, "avgScore": 0.891 }
}
```

**MCP `concept_evolution` tool**

New MCP tool that exposes the same capability to agents:

```ts
concept_evolution(
  query: string,            // concept to trace, e.g. "authentication"
  top_k?: number,           // default 50
  threshold?: number,       // default 0.3
  structured?: boolean,     // return JSON instead of human-readable text
  include_content?: boolean // add stored file text per entry (with structured=true)
): string
```

**New module additions**

| Module | Addition |
|---|---|
| `src/core/indexing/blobStore.ts` | `getBlobContent(blobHash)` export |
| `src/core/search/evolution.ts` | `ConceptEvolutionEntry` interface, `computeConceptEvolution()` function |
| `src/cli/commands/conceptEvolution.ts` | CLI command handler |
| `src/mcp/server.ts` | `concept_evolution` tool registration |

**Deliverable:** Agents using the MCP layer can retrieve the full file content at
every historical version, and can ask "how did concept X evolve?" across the
entire codebase history — not just within a single file.

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

---

### Phase 12 — CLI consolidation & robust per-file indexing

**Version:** implemented in 0.12.0

**Goal:** Reduce top-level commands and make single-file indexing first-class and resilient.

Summary of recent changes:

- Consolidated `index-file` into `index --file` which accepts multiple paths.
- `gitsema index --file a b` runs per-file indexing in parallel, respecting `--concurrency`.
- `index --file` now uses the same multi-level fallback strategy as the main indexer:
  - Try whole-file embedding
  - On context-length errors: fallback to `function` chunker
  - If function chunks still exceed context: try fixed windows (1500 → 800) per chunk
- Removed the top-level `index-file` command to reduce first-level keywords.
- `status <file>` remains positional for quick checks.

Why this helps:

- Simplifies the CLI surface area while preserving expressiveness.
- Makes targeted indexing (single files) reliable for large files without manual retry.
- Keeps behavioral parity between bulk indexing and ad-hoc per-file indexing.

Next possible improvements:

- Expose fallback parameters (`fixed` window sizes, overlap) via CLI flags.
- Add `--file` to `mcp` / programmatic API surface for scripted workflows.

---

### Recent progress (snapshot: 2026-04-01)

- **Commit hash in outputs:** Short commit hashes are shown next to first-seen dates and in `status`/ranking outputs.
- **`--origin` for evolution:** `gitsema evolution` accepts an `--origin`/origin blob ref to anchor distance calculations.
- **Robust indexer fallbacks & counters:** Indexer now tracks `embedFailed` / `otherFailed` and applies a multi-stage fallback: whole-file → `function` chunker → fixed windows (1500, then 800, overlap 200).
- **Per-file indexing:** `index --file <paths...>` is implemented (parallel, respects `--concurrency`); `index-file` command removed.
- **Status improvements:** `status <file>` resolves repo-relative paths when run from subdirectories and prints a compact, aligned key/value summary.
- **Persistent logging & `--verbose`:** `logger` writes to `.gitsema/gitsema.log` with single-file rotation to `.gitsema/gitsema.log.1`. `--verbose` or `GITSEMA_VERBOSE=1` enables debug output to console and log.
- **Chunk listing (verbose):** `status --verbose` lists chunk ranges; to avoid leaking large content it now prints a compact snippet (first 15 chars of the first line and last 15 chars of the last line) per chunk.
- **Chunk dedupe & safety:** `storeChunk()` was hardened to avoid creating duplicate chunk rows; a dedupe script was run and found no exact duplicates.
- **Version reporting:** CLI reads `package.json` for the program version so `gitsema -V`/status show the actual package version.

These items reflect recent development iterations focused on reliability and observability for indexing large files and making per-file workflows predictable.

---

### Phase 13 — Standalone model server for embeddings

**Version:** implemented in 0.13.0

**Goal:** Provide a lightweight, local HTTP model-server that can download embedding models from Hugging Face, host them locally, and expose a stable HTTP embedding API for `gitsema` (or other tools) to consume. This decouples model hosting from the CLI, reduces cross-language integration friction, and makes it easier to run models on dedicated machines with GPUs.

Design decisions:

- Use Python + FastAPI for broad ecosystem support and easy deployment with `uvicorn`.
- Support two runtime paths: `sentence-transformers` models when available (simple API), and transformer-based models using `transformers` + `torch` with mean-pooling as a fallback.
- Use `huggingface_hub` to download and cache models locally; the server exposes a `/download` endpoint to fetch a model and a `/embed` endpoint to compute embeddings.
- Provide a minimal model registry in-memory that maps model names → loaded model objects; models can be preloaded at startup or downloaded on-demand.
- Return JSON embeddings (float32 list) and accept batch inputs. Include metadata (model, dims, device).

API (examples):

- `POST /download` { "model": "sentence-transformers/all-MiniLM-L6-v2" }
- `POST /embed` { "model": "all-MiniLM-L6-v2", "texts": ["hello world", "foo"] }

Security & production notes:

- Authentication is intentionally omitted in the first iteration; add API keys or mTLS for production.
- Provide an environment variable to restrict allowed HF models or to point at a private HF token via `HUGGINGFACE_TOKEN`.
- Expose metrics and health endpoints for orchestration.

Deliverables:

- `modelserver/server.py` — FastAPI app implementing `/download`, `/embed`, `/models`, `/health` endpoints.
- `modelserver/requirements.txt` — Pin of runtime deps: `fastapi`, `uvicorn`, `sentence-transformers`, `transformers`, `torch`, `huggingface-hub`.
- `modelserver/README.md` — Quick start and run commands.

This phase makes it easy to run a local embedding service that `gitsema` can point at via `GITSEMA_PROVIDER=http://localhost:8000` (or an HTTP provider shim). It also enables running heavier GPU-backed models on separate hardware without changing the CLI code.

---

#### Implementation snapshot (actions taken)

- **Environment:** started preparing a local modelserver scaffold (FastAPI) under `modelserver/`.
- **Git ignore:** added `modelserver/models/`, `.cache/huggingface/`, and `.cache/torch/` to `.gitignore` to avoid committing downloaded model artifacts.
- **CUDA preference:** intend to run the modelserver with `USE_CUDA=1` to prefer GPU when available.
- **Model targeted:** plan to download `nomic-ai/CodeRankEmbed` as a first test model; the server exposes `/download` to fetch models on-demand and `/embed` to compute embeddings.

---

Runbook (how to start and download `nomic-ai/CodeRankEmbed`):

1. Create a Python venv and install deps:

```bash
python -m venv .venv
.venv\Scripts\activate     # Windows
pip install -r modelserver/requirements.txt
```

2. Start the server preferring CUDA:

```bash
set USE_CUDA=1            # Windows CMD
# or PowerShell: $env:USE_CUDA = '1'
uvicorn modelserver.server:app --host 0.0.0.0 --port 8000
```

3. Download the model and verify embedding:

```bash
curl -X POST http://localhost:8000/download -H "Content-Type: application/json" \
  -d '{"model":"nomic-ai/CodeRankEmbed"}'

curl -X POST http://localhost:8000/embed -H "Content-Type: application/json" \
  -d '{"model":"nomic-ai/CodeRankEmbed","texts":["int main() { return 0; }"]}'
```

Notes:

- Model downloads can be large; set `HUGGINGFACE_TOKEN` if the model requires auth.
- If `sentence-transformers` loading fails, the server falls back to a `transformers` mean-pooling loader.

Run attempt note:

- A local attempt to install `modelserver` dependencies in a Windows dev environment failed while building native wheels (the `tokenizers` package requires a Rust toolchain). To run the server locally you may need to install Rust/Cargo or use a prebuilt environment (Docker/Conda) that provides the binary wheels.

---

### Phase 14 — Infrastructure, tooling, and maintenance

**Version:** implemented in 0.14.0

**Goal:** Close the operational gaps that exist now that the feature set is complete. No new search or indexing capabilities — this phase is about making the project reliable, testable, and easy to onboard.

**Items (priority order):**

**1. Test suite**

The single largest gap. Add a test framework (Vitest is the natural choice — ESM-native, TypeScript-first, no extra config).

- Integration tests for the indexer: create a small fixture Git repo in-process, run `runIndex`, assert blob/embedding/commit counts.
- Unit tests for chunking: cover `fileChunker`, `functionChunker`, `fixedChunker` with edge cases (empty file, single-function file, file that exceeds one window).
- Unit tests for search ranking: `cosineSimilarity`, `pathRelevanceScore`, `groupResults`.
- Integration test for hybrid search: index fixture repo with FTS5, assert BM25 path degrades gracefully to vector-only when query has no FTS5 hits.

Target: `pnpm test` runs green. Add to CI.

**2. CI/CD (GitHub Actions)**

Two workflows:

- `ci.yml` — triggered on every push and PR: `pnpm install`, `pnpm build` (type-check), `pnpm test`.
- `release.yml` — triggered on version tags (`v*`): build + publish to npm (or just GitHub Releases).

**3. `.env.example`**

Add a `.env.example` at repo root documenting all `GITSEMA_*` variables with inline comments. Referenced in README and CLAUDE.md.

**4. `gitsema backfill-fts` command**

Blobs indexed before Phase 11 have no FTS5 content. Add a maintenance command that iterates all blobs in the DB that have no `blob_fts` entry and re-fetches their content from the Git object store to populate the FTS5 table. Useful after upgrading from an older index.

**5. Schema migration**

Define a `gitsema migrate` command (or a startup check) that applies additive schema changes when the DB version is behind the current schema. Store a `schema_version` in a `meta` table. This prevents breakage when users upgrade gitsema against an existing `.gitsema/index.db`.

**6. Docker image for Phase 13 model server**

The Python model server is blocked on Windows because `tokenizers` requires a Rust toolchain at install time. Provide a `modelserver/Dockerfile` that uses a prebuilt Python image with the wheels already installed. This lets any platform run the model server without Rust or Conda.

```dockerfile
# modelserver/Dockerfile (sketch)
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py .
EXPOSE 8000
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
```

**Deliverable:** `pnpm test` is green, CI passes on PRs, new contributors can onboard from `.env.example` alone, and existing users with pre-Phase-11 indexes can recover full hybrid search via `backfill-fts`.

---

### Phase 14b — Search result deduplication

**Version:** implemented in 0.15.1

**Goal:** Each unique blob appears at most once in search results, even when chunk embeddings are included.

**Problem:** When `--chunks` is used (or chunks were indexed), `vectorSearch` adds one candidate entry per chunk for a given blob hash. After scoring, the top-K slice can return multiple entries for the same blob (e.g. chunks 3, 7, and 11 of the same file all land in the top 10). The caller sees the same file path listed three times with slightly different scores — confusing and wasteful.

**Fix — deduplicate by `blobHash` before slicing:**

In `vectorSearch` ([src/core/search/vectorSearch.ts](src/core/search/vectorSearch.ts)), after computing `finalScored` and sorting descending, group by `blobHash` and keep only the highest-scoring entry per blob before slicing to `topK`. The winning entry retains its `chunkId`/`startLine`/`endLine` so callers still know which chunk matched best.

```ts
// After sort, before slice:
const bestByBlob = new Map<string, FinalEntry>()
for (const entry of finalScored) {
  const existing = bestByBlob.get(entry.blobHash)
  if (!existing || entry.score > existing.score) {
    bestByBlob.set(entry.blobHash, entry)
  }
}
const topEntries = Array.from(bestByBlob.values())
  .sort((a, b) => b.score - a.score)
  .slice(0, topK)
```

This is strictly an improvement: the same blob hash appearing twice was never useful, and dedup-then-slice gives topK *distinct blobs* rather than topK *candidate vectors*.

**Scope:** Change is confined to `vectorSearch` in [src/core/search/vectorSearch.ts](src/core/search/vectorSearch.ts). No schema changes, no CLI flag changes. The existing `--group file` option (which deduplicates by path across different blob hashes) is orthogonal and unchanged.

**Deliverable:** `gitsema search "..." --chunks` returns at most one entry per unique file version. No regressions on non-chunk search paths.

---

### Phase 15 — Branch awareness

**Version:** implemented in 0.15.0

**Goal:** Correct `--since <ref>` indexing across all branches and add branch metadata to enable branch-scoped search.

**Two problems:**

1. **Bug** — `revList` ([src/core/git/revList.ts:50](src/core/git/revList.ts#L50)) uses `${since}..HEAD` for the ref/tag form of `--since`. This walks only commits reachable from HEAD, silently skipping blobs that exist exclusively on other branches. The date form (`--after`) correctly uses `--all`.

2. **No branch metadata** — The schema has no concept of which branches reference a blob. Users cannot ask "show me results only from `main`" or "what branches introduced this code?".

**Changes:**

**1. Fix `--since <ref>` in revList.ts**

Change the ref-range form from `${since}..HEAD` to `--all --not ${since}`. This gives all objects reachable from any ref that are not reachable from `<since>` — the correct multi-branch equivalent.

```ts
// Before:
revListArgs = ['rev-list', '--objects', `${since}..HEAD`]
// After:
revListArgs = ['rev-list', '--objects', '--all', '--not', since]
```

**File:** [src/core/git/revList.ts](src/core/git/revList.ts)

**2. Add `blob_branches` join table**

```ts
// schema.ts addition
blobBranches: {
  blobHash:   TEXT  FK → blobs.hash
  branchName: TEXT  -- short ref name (e.g. "main", "feature/auth")
  PRIMARY KEY (blobHash, branchName)
}
```

**Files:** [src/core/db/schema.ts](src/core/db/schema.ts), [src/core/db/sqlite.ts](src/core/db/sqlite.ts)

**3. Capture branch associations during indexing**

Before the streaming pass, build a `Map<commitHash, branchName[]>` by running `git log --all --format="%H %D"` and parsing the ref decorations (`%D`). During `streamCommitMap`, emit a `branches` field per commit event. The indexer writes `blob_branches` rows for each blob introduced by a commit.

**Files:** [src/core/git/commitMap.ts](src/core/git/commitMap.ts), [src/core/indexing/indexer.ts](src/core/indexing/indexer.ts), [src/core/indexing/blobStore.ts](src/core/indexing/blobStore.ts)

**4. `--branch <name>` flag on `gitsema index`**

Restricts indexing to a single branch (useful for large repos where only one branch matters):

```
gitsema index --branch feature/auth
```

Passes `refs/heads/<name>` instead of `--all` to both `revList` and `streamCommitMap`.

**File:** [src/cli/commands/index.ts](src/cli/commands/index.ts) (or equivalent — verify path), [src/cli/index.ts](src/cli/index.ts)

**5. `--branch <name>` filter on `gitsema search`**

Adds a JOIN on `blob_branches` to restrict results to blobs seen on the specified branch:

```
gitsema search "auth middleware" --branch main
```

**Files:** [src/core/search/vectorSearch.ts](src/core/search/vectorSearch.ts), [src/cli/commands/search.ts](src/cli/commands/search.ts)

**Deliverable:** `--since <tag>` correctly picks up blobs from all branches. `gitsema search "..." --branch main` scopes results to the main branch. `gitsema status` reports branch count in the index.

---

### Phase 16 — Remote-repository indexing (server-managed clone, RAM-backed working tree, persistent DB)

**Version:** implemented in 0.16.0

**Goal:** Add a third operational mode in which the user supplies only a remote Git URL and optional credentials. The gitsema server clones the repository into a RAM-backed temporary directory (so the working tree never touches persistent storage), runs the full indexing pipeline, and writes the resulting embeddings index to the normal on-disk SQLite database. The repo exists transiently in server memory; the index DB is always durable.

---

**Three-way positioning**

| Mode | Repo location | Index (SQLite) | Who clones |
|---|---|---|---|
| 1 — local | user's disk | `.gitsema/index.db` on user's disk | user (pre-existing repo) |
| 2 — client-server | user's disk | server's disk | user (pre-existing repo) |
| **3 — fully remote** | **server RAM (tmpfs)** | **server's disk** | **server, on demand** |

In Mode 3 the user only needs to know the remote URL and (optionally) a token. They never run `git clone` themselves and never store the repository on their own machine. The clone is held in server RAM during indexing and discarded afterwards; the embeddings DB remains durably on the server's disk.

---

**Is cloning necessary?**

Yes, for general Git repos — Git's object protocol makes it the only portable way to walk full history across arbitrary hosts. However:

- A **shallow clone** (`--depth N` or `--shallow-since <date>`) is sufficient when only recent history is needed. This is much faster and uses far less disk space in the temp directory.
- A **full clone** is required for `evolution`, `first-seen`, and `concept-evolution` commands that need multi-commit history.
- GitHub/GitLab REST APIs could enumerate blobs without cloning, but that path is platform-specific, paginates at tree-level only, and cannot provide commit timestamps cheaply — not worth the complexity in Phase 16.

The clone lives in a temporary directory on the server and is deleted after indexing (or kept according to a configurable cleanup strategy — see below).

---

**Changes**

**1. RAM-backed clone directory**

The Git working tree (clone) should never touch the server's persistent disk. On Linux, `/dev/shm` is a kernel-managed tmpfs (RAM-backed) filesystem. Setting `GITSEMA_CLONE_DIR=/dev/shm` ensures that all temporary clone data lives only in server RAM and is automatically freed when the process exits or the directory is deleted — even if the cleanup callback is never called (e.g. a crash). On macOS the equivalent is a RAM disk created with `hdiutil`; in a container environment any path on a tmpfs mount (e.g. a Docker `tmpfs` volume) works.

The default value for `GITSEMA_CLONE_DIR` is `os.tmpdir()`. On most modern Linux systems `/tmp` is already a tmpfs (`mount | grep /tmp`), so the default provides RAM-backed behaviour without extra configuration. Operators who want an explicit guarantee should set `GITSEMA_CLONE_DIR=/dev/shm`.

**Note:** The embeddings/index SQLite database is **always written to disk** (`.gitsema/index.db` or the path from the existing configuration). In-memory databases are not used in Phase 16 — durability of the index is a hard requirement.

**Files:** `src/core/db/sqlite.ts` (no change needed — DB path remains on-disk), `src/core/git/cloneRepo.ts` (new file, reads `GITSEMA_CLONE_DIR`)

---

**2. New server route: `POST /api/v1/remote/index`**

Triggers a server-side clone-and-index operation. No blob content is sent by the client — the server fetches everything itself.

*Request body (Zod-validated):*
```json
{
  "repoUrl": "https://github.com/owner/repo.git",
  "credentials": {
    "type": "token",
    "token": "ghp_..."
  },
  "cloneDepth": null,
  "indexOptions": {
    "since": null,
    "maxCommits": null,
    "concurrency": 4,
    "ext": [],
    "maxSize": "200kb",
    "exclude": [],
    "chunker": "file"
  }
}
```

`credentials` is optional (for public repos). `type` can be `"token"` (GitHub personal-access-token / GitLab token) or `"basic"` (username + password). SSH URLs are rejected in Phase 16 (deferred to Phase 17 — see notes below).

*Server-side flow:*

1. Validate request with Zod. Reject any `repoUrl` that is not an `https://` URL (security guard — prevents SSRF to internal services and path-injection).
2. Embed credentials directly in the clone URL so nothing is written to a credential file on disk:
   - Token: `https://<token>@github.com/owner/repo.git`
   - Basic: `https://<user>:<pass>@github.com/owner/repo.git`
3. Create a unique temp directory with `mkdtemp(join(os.tmpdir(), 'gitsema-'))`.
4. Run `git clone [--depth N] <url-with-credentials> <tmpDir>` via `spawn` (never via shell, so the credential-embedded URL does not leak to a shell history). **Note:** argv is still visible in `/proc/<pid>/cmdline` on Linux regardless of how the process is spawned, so credentials embedded in the URL *will* appear in `ps` output; Phase 17 replaces this with a `GIT_ASKPASS` helper script.
5. Call `runIndex({ repoPath: tmpDir, ...indexOptions })`.
6. In a `finally` block, clean up the temp directory according to `GITSEMA_CLONE_KEEP` (see item 4 below).
7. Return `IndexStats` as JSON.

*New files:*
- `src/server/routes/remote.ts` — route handler
- `src/server/routes/remote.test.ts` — integration test (Phase 14 test suite)

Register the router in `src/server/app.ts`:
```ts
import { remoteRouter } from './routes/remote.js'
// …
app.use(`${base}/remote`, remoteRouter({ textProvider, codeProvider, chunkerStrategy, concurrency }))
```

---

**3. Clone cleanup strategies — `GITSEMA_CLONE_KEEP`**

| Value | Behaviour |
|---|---|
| `always` | Delete temp clone immediately after indexing, whether it succeeded or failed. **(default)** |
| `on-success` | Delete only if indexing succeeds; keep on failure for manual inspection. |
| `keep` | Keep the clone indefinitely. On a subsequent call to `POST /remote/index` with the same URL, the server detects the existing clone and runs `git fetch --all` instead of a fresh clone. This is faster for incremental re-indexing. |

Implemented in a small helper `src/core/git/cloneRepo.ts`:
```ts
export interface CloneResult {
  tmpDir: string
  cleanup: () => Promise<void>
}

export async function cloneRepo(
  repoUrl: string,
  credentialsUrl: string, // URL with credentials embedded
  depth?: number,
): Promise<CloneResult>
```

The helper manages the temp-dir lifecycle and exposes a `cleanup()` callback that the route handler calls in its `finally` block.

**File:** `src/core/git/cloneRepo.ts`

---

**4. Incremental re-indexing of remote repos**

When `GITSEMA_CLONE_KEEP=keep` and the temp dir is preserved, a second call to `POST /remote/index` for the same URL should skip the full clone and instead run `git fetch --all` to update the existing clone. This requires the server to maintain a registry:

```ts
// In-memory map: normalised repo URL → existing clone path
const cloneRegistry = new Map<string, string>()
```

On each request:
1. Look up `cloneRegistry.get(normalisedUrl)`.
2. If found and the directory still exists: run `git fetch --all` in it.
3. If not found or directory missing: run `git clone` into a new temp dir and register it.

This registry is in-memory only (no file). It is lost on server restart.

**File:** `src/server/routes/remote.ts` (or a small `src/core/git/cloneRegistry.ts`)

---

**5. New CLI command: `gitsema remote-index <repoUrl>`**

A thin wrapper that calls `POST /api/v1/remote/index` on the configured `GITSEMA_REMOTE` server. Lets users trigger server-side indexing without curl.

```
gitsema remote-index https://github.com/owner/repo.git \
  --token ghp_... \
  --depth 500 \
  --concurrency 8
```

Flags mirror the `indexOptions` fields of the request body plus `--token`, `--username`, `--password` for credentials. After the call returns, the user can run `gitsema search` (which proxies through `GITSEMA_REMOTE`) to query the freshly built index.

**Files:** `src/cli/commands/remoteIndex.ts`, `src/cli/index.ts`

---

**6. New environment variables**

| Variable | Default | Description |
|---|---|---|
| `GITSEMA_CLONE_DIR` | `os.tmpdir()` | Parent directory for temporary Git clones. Set to `/dev/shm` (Linux) or a tmpfs mount path to guarantee RAM-only storage for the working tree. |
| `GITSEMA_CLONE_KEEP` | `always` | Clone cleanup strategy: `always` / `on-success` / `keep`. |
| `GITSEMA_CLONE_MAX_BYTES` | `2147483648` (2 GB) | Maximum size of a single clone. The server monitors the temp dir during cloning and aborts if this threshold is crossed. Applies to the in-RAM tmpfs too — prevents OOM from oversized repos. |

---

**Security considerations**

The Phase 16 attack surface is wider than the local modes because the server now performs network I/O (git clone) and OS operations (temp dir creation, process spawning) on behalf of untrusted request payloads. Each risk below is paired with a concrete mitigation that must be implemented before the route is deployed.

**SSRF — Server-Side Request Forgery**

An attacker can supply a `repoUrl` that resolves to an internal service (metadata endpoints, databases, message queues) rather than a legitimate Git host.

*Mitigations:*
- Enforce `https://` scheme at validation time. Reject `http://`, `git://`, `ssh://`, `file://`, and any other scheme.
- After parsing the URL, resolve its hostname to all IP addresses via DNS (`dns.resolve4` + `dns.resolve6`). Check every resolved address against the blocked ranges before spawning git. Blocked ranges: `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` (link-local), `::1`, `fc00::/7` (IPv6 unique-local), `fe80::/10` (IPv6 link-local).
- **DNS-rebinding guard:** The DNS check happens before the clone starts, but a malicious hostname could resolve differently during the actual TCP connection (rebinding attack). Mitigation: after the clone subprocess exits, verify the host resolves to the same address it did at validation time. Alternatively, use a custom `resolv.conf` that pins the lookup result, or use `--resolve <host>:<port>:<ip>` in the git command to hard-code the IP.
- Log the sanitised URL (no credentials); never log the IP addresses resolved to avoid leaking internal topology.

**Credential leakage — process list**

When credentials are embedded in the clone URL (`https://<token>@host/...`), the full URL appears in `/proc/<pid>/cmdline` on Linux and in `ps` output, which any local user can read.

*Mitigations (Phase 16):*
- Never use shell invocation (`{ shell: true }`) for the git spawn call. Use `spawn` with an argv array — this does not prevent `/proc` exposure but at least eliminates shell history.
- Document the risk explicitly in the operator runbook.

*Planned improvement (Phase 17):* Replace credential-in-URL with a `GIT_ASKPASS` helper: write a small shell script to a temp file (`chmod 600`), set `GIT_ASKPASS` in the git environment, and delete the script immediately after clone. This keeps credentials out of argv entirely.

**Credential leakage — logs and API responses**

Git may echo the remote URL in error messages (e.g. authentication failures), which can then surface in server logs or HTTP error responses.

*Mitigations:*
- Define a `sanitiseUrl(url: string): string` helper that strips `user:pass@` from any URL string. Call it on all git stderr output before writing to `logger` and on all error messages before returning them in HTTP responses.
- In the route handler `catch` block, wrap git error messages: `throw new Error(sanitiseUrl(err.message))`.
- Apply the same sanitisation to the `indexOptions.since` field if it ever contains a URL.

**Oversized and malicious repositories**

A repo could be crafted to consume the entire available RAM/disk on the server tmpfs or exceed compute budget during indexing.

*Mitigations:*
- Implement `GITSEMA_CLONE_MAX_BYTES` (default 2 GB). The `cloneRepo` helper spawns a background polling loop (`setInterval`) that runs `du -sb <tmpDir>` every 5 seconds during cloning. If the total exceeds the limit the clone subprocess is killed and the temp dir removed.
- Apply the existing `--max-size` blob filter during indexing (prevents the indexer from reading individual files that exceed the per-blob limit).
- Set a wall-clock timeout for the clone operation (default: 10 minutes, configurable via `GITSEMA_CLONE_TIMEOUT_MS`). Exceeded timeout kills the subprocess and returns HTTP 504.

**DoS — parallel clone requests**

Multiple concurrent clone operations could exhaust server memory or network bandwidth.

*Mitigations:*
- Maintain a server-wide `Semaphore` (default permits: 2) in `src/server/routes/remote.ts`. Requests that cannot acquire a permit immediately receive HTTP 429 with a `Retry-After` header.
- The semaphore limit is configurable via `GITSEMA_CLONE_CONCURRENCY` (integer ≥ 1, default 2).

**Path traversal**

A crafted `repoUrl` or `indexOptions` field could attempt path traversal to access files outside the intended temp directory.

*Mitigations:*
- Always use `mkdtemp(join(cloneDir, 'gitsema-'))` for the temp directory name — never accept a path from the request body.
- Validate that `indexOptions` fields (`ext`, `exclude`, `chunker`) match expected Zod schemas exactly; reject unknown keys.

**Request body size**

Large JSON bodies (e.g. many large `exclude` patterns) could cause memory pressure.

*Mitigation:* The Express `json({ limit: '50mb' })` middleware already applies globally. The remote route additionally validates that array fields (`ext`, `exclude`) have at most 100 entries and that individual strings are at most 256 characters.

---

**What is NOT in scope for Phase 16**

- **SSH repository URLs** — require temp SSH key files + `ssh-agent` configuration.
- **`GIT_ASKPASS` credential handling** — improves process-list exposure of credentials embedded in the clone URL.
- **Per-repo in-memory DB registry / multi-repo sessions** — a single shared DB serves all repos indexed by the server.
- **Streaming progress** — `POST /remote/index` is a synchronous long-poll; live progress events need Server-Sent Events.

These items are deferred to **Phase 17** (see below).

---

**Deliverables**

- `POST /api/v1/remote/index` on the gitsema server accepts a HTTPS Git URL plus optional token/basic credentials, clones into a RAM-backed temp dir (`/dev/shm` or system tmpfs), indexes the repo, writes embeddings to the persistent on-disk SQLite DB, cleans up the clone, and returns `IndexStats`.
- `gitsema remote-index <url>` CLI command is a one-liner that triggers remote indexing without curl.
- All Phase 16 security mitigations (SSRF guard, DNS-rebinding check, credential log sanitisation, clone-size limit, wall-clock timeout, concurrency semaphore) are implemented from day one.

---

### Phase 17 — Remote-indexing hardening and SSH support

**Version:** implemented in 0.17.0

**Goal:** Harden the Phase 16 remote-indexing mode with credential isolation, SSH support, per-repo database sessions, and live progress streaming.

**Items:**

**1. `GIT_ASKPASS` credential handling**

Replace the credential-in-URL approach from Phase 16 with a `GIT_ASKPASS` helper script. The helper is written to a temp file with permissions `0600`, referenced via the `GIT_ASKPASS` environment variable passed to the `git clone` spawn call, and deleted immediately after the clone completes (in a `finally` block). This keeps credentials entirely out of `argv` and therefore out of `/proc/<pid>/cmdline` and `ps` output.

```ts
// sketch
const askPassScript = `#!/bin/sh\necho "${escapedToken}"\n`
const scriptPath = await writeSecureTemp(askPassScript) // chmod 600
try {
  await spawnGit(['clone', repoUrl, tmpDir], { env: { GIT_ASKPASS: scriptPath } })
} finally {
  await fs.rm(scriptPath, { force: true })
}
```

**File:** `src/core/git/cloneRepo.ts`

**2. SSH repository URLs**

Accept `ssh://git@host/owner/repo.git` and `git@host:owner/repo.git` URLs. The caller provides an SSH private key as a string in the request body (PEM-encoded). The server writes the key to a temp file with permissions `0600`, sets `GIT_SSH_COMMAND` to point to it, and deletes it in `finally`.

```json
{
  "repoUrl": "git@github.com:owner/repo.git",
  "credentials": {
    "type": "ssh-key",
    "privateKey": "-----BEGIN OPENSSH PRIVATE KEY-----\n..."
  }
}
```

The SSRF guard for SSH URLs is different from HTTPS: resolve the hostname to IP and apply the same private-range blocklist, but the scheme check switches from `https://` to `ssh://` or the SCP shorthand.

**Files:** `src/server/routes/remote.ts`, `src/core/git/cloneRepo.ts`

**3. Per-repo database sessions**

Currently all repos indexed by the server share a single SQLite DB. Add an optional `dbLabel` field to `POST /remote/index` that routes the indexing run to a separate database file (`.gitsema/<label>.db`). This allows a single server instance to maintain isolated indexes for multiple repos.

```json
{ "repoUrl": "...", "dbLabel": "my-project" }
```

**File:** `src/core/db/sqlite.ts`, `src/server/routes/remote.ts`

**4. Streaming progress via Server-Sent Events**

`POST /remote/index` is currently a synchronous long-poll that returns only after indexing completes (potentially many minutes for large repos). Add a `GET /api/v1/remote/jobs/:jobId/progress` SSE endpoint:

1. `POST /remote/index` starts the job asynchronously and returns `{ jobId }` immediately.
2. The client subscribes to `GET /remote/jobs/:jobId/progress` to receive `IndexStats` snapshots as SSE events.
3. A final event signals completion or failure.

**Files:** `src/server/routes/remote.ts`, new `src/server/routes/jobs.ts`

**5. `gitsema remote-index` — polling mode**

Update the CLI command (`src/cli/commands/remoteIndex.ts`) to use the async job API: post the request, then poll (or use SSE) the progress endpoint and render a live progress bar (reusing the existing CLI progress bar from `gitsema index`).

**Deliverable:** Credentials never appear in process lists. SSH repos work. Large-repo indexing jobs are non-blocking and observable. Multiple repos can share a single server with isolated indexes.

---

### Phase 18 — Reliability, tests, and query caching

**Version:** implemented in 0.18.0

**Goals:** Fix the remote job registry memory leak, add a comprehensive test suite, and introduce a query embedding cache in the DB to accelerate repeated queries.

- **Remote job registry stability:** Implement eviction and durable housekeeping for the in-memory job registry. Add a TTL, size cap, LRU eviction, and an option to persist recent job metadata to disk so completed jobs can be resurrected after a restart for debugging. Add monitoring metrics (job count, retained entries, eviction rate).
- **Test suite (see II.4):** Expand the Vitest plan: unit tests for chunkers, ranking, and DB helpers; integration tests that create tiny fixture Git repos, run `index` and `search`, and assert end-to-end behavior (embeddings written, FTS5 populated, `first-seen` results correct). Aim for `pnpm test` passing locally and in CI.
- **Embedding query cache:** Store query strings + provider model → embedding vector in a new `query_embeddings` table. On search, check the cache before calling the provider; use model name + model-specific config as the cache key. Add TTL and a size cap; expose `--no-cache` for deterministic runs.

**Deliverables:** Memory-safe job registry with metrics; test suite covering core paths and CI integration; `query_embeddings` table and cache-aware search path.

---

### Phase 19 — Smarter chunking, semantic blame & symbol-level embeddings

**Version:** implemented in 0.19.0

**Goals:** Improve chunk quality via AST-based splitting, implement a repo-wide semantic blame (nearest-neighbor blame) tool, and introduce symbol-level embeddings as a new indexing tier that captures function identity and enriched metadata.

#### Chunker improvements

Replaced the single catch-all regex with **tree-sitter AST parsing** as the primary splitting strategy for the `function` chunker, with language-specific regex patterns as a graceful fallback when tree-sitter is unavailable (e.g. no C++ toolchain, CI without native build support).

Tree-sitter grammars are added as `optionalDependencies` — installation failures are non-blocking and the chunker silently degrades.

Per-language top-level declaration types:

| Language | Extension(s) | AST node types |
|---|---|---|
| Python | `.py`, `.pyi` | `decorated_definition` (decorator + function grouped), `function_definition`, `class_definition` |
| Go | `.go` | `function_declaration`, `method_declaration` |
| Rust | `.rs` | `function_item`, `impl_item`, `struct_item`, `enum_item`, `trait_item` |
| TypeScript/TSX | `.ts`, `.tsx` | `export_statement`, `function_declaration`, `class_declaration`, `lexical_declaration` |
| JavaScript | `.js`, `.jsx`, `.mjs`, `.cjs` | same as TypeScript |
| Java/C# | `.java`, `.cs`, `.kt`, `.scala` | regex-only fallback |

#### Semantic blame

Implemented `gitsema semantic-blame <file>`: for each logical block in the file (using the function chunker), finds the nearest-neighbor blobs historically and attributes concept origin by semantic proximity rather than textual changes. Returns commit + author + date for each semantic origin. Supports `--top <n>` and `--dump [file]` for JSON output.

#### Symbol-level embeddings (new indexing tier)

Added a new level of embedding — **symbol-level** — that sits alongside blob-level embeddings without replacing them. Symbol embeddings capture named declarations (functions, classes, methods, impl blocks, etc.) and embed them with **enriched context** that includes the file path, symbol name, and kind:

```
// file: src/auth/jwt.ts  (jwt.ts)  lines 10-25
// function: validateToken
export async function validateToken(token: string): Promise<boolean> { ... }
```

This enriched text lets the embedding model resolve natural-language queries ("authentication middleware") to the right symbol — not just the right file.

**New database tables (schema v4):**

| Table | Purpose |
|---|---|
| `symbols` | One row per named declaration: `blob_hash`, `start_line`, `end_line`, `symbol_name`, `symbol_kind`, `language` |
| `symbol_embeddings` | Vector embedding of the enriched text, keyed by `symbol_id` |

**What is stored in each column:**
- `symbol_name` — extracted identifier (e.g. `validateToken`, `Auth`, `Repository`)
- `symbol_kind` — `function` \| `class` \| `method` \| `impl` \| `struct` \| `enum` \| `trait` \| `other`
- `language` — detected language (`typescript`, `python`, `go`, `rust`, etc.)
- `symbol_embeddings.vector` — Float32 embedding of the enriched preamble + code text

**When symbols are indexed:** Symbol extraction runs automatically when `--chunker function` is used. Each chunk that carries a `symbolName` (from tree-sitter or the regex fallback) triggers an additional embedding of the enriched text, stored separately in the `symbols`/`symbol_embeddings` tables. Failures are non-fatal — chunk embeddings succeed independently.

**Symbol-level search:** `vectorSearch` accepts `searchSymbols: true` to include symbol-level candidates alongside blob-level ones. Results include `symbolId`, `symbolName`, `symbolKind`, and `language` fields.

**Deliverables:**
- Tree-sitter-based `FunctionChunker` with regex fallback
- `gitsema semantic-blame` CLI command
- `symbols` + `symbol_embeddings` DB tables (schema v4 migration)
- `storeSymbol()` write path and `searchSymbols` read path
- Test suite: 97 tests covering chunker symbol extraction, DB storage, search, and deduplication

---

### Phase 20 — Dead-concept detection & refactor impact analysis

**Version:** implemented in 0.20.0

**Goals:** Surface concepts that have vanished from HEAD but exist historically, and flag likely refactor impact before large structural changes.

- **Dead concept detection:** Add `gitsema dead-concepts [--since] [-k]` which finds embeddings that score highly to a set of current blobs but whose earliest paths/commits are not present in HEAD. Report candidates with score, last-seen commit, and paths where they lived.
- **Refactor impact analysis:** Implement `gitsema impact <path>` which computes the top-N semantically similar blobs across the codebase and highlights cross-module coupling. Use the chunk-level index to show granular coupling (line ranges/chunks) and surface high-impact targets for review.

**Deliverables:** `dead-concepts` and `impact` commands, sample reports, and guidance for using them during refactors.

---

### Phase 21 — Semantic clustering & concept graph

**Version:** implemented in 0.21.0

**Goals:** Cluster embeddings into semantic regions and visualise a lightweight concept graph for onboarding and exploration.

- **Clustering:** Add an offline `cluster` job that vectors all blob embeddings, reduces dimensionality, and clusters (e.g., HDBSCAN or k-means). Store cluster membership in `blob_clusters` with metadata (centroid, size, representative paths).
- **Concept graph:** Build a `concept_graph` view connecting clusters by nearest-centroid similarity and exposing top keywords (from FTS5) per cluster. Provide a CLI `gitsema clusters --top <n>` and an optional small web UI to render nodes/edges.

**Deliverables:** Persistent cluster assignments, `gitsema clusters` CLI, and a concept graph generator useful for onboarding and architectural insights.

---

### Phase 22 — Temporal cluster diff

**Version:** implemented in 0.21.0

**Goals:** Compare semantic cluster snapshots at two points in history.

- **`gitsema cluster-diff <ref1> <ref2>`:** compute clusters for blobs visible at each ref and compare; reports new, dissolved, drifted, stable, and migrated clusters.
- New core functions: `ClusterSnapshot`, `compareClusterSnapshots`, `resolveRefToTimestamp`, `getBlobHashesUpTo`.

**Deliverables:** `cluster-diff` command, `ClusterSnapshot` types, schema v6 (timestamp index), tests.

---

### Phase 23 — Cluster timeline

**Version:** implemented in 0.22.0

**Goals:** Track how semantic clusters shift across the full commit history via multi-step checkpoints.

- **`gitsema cluster-timeline`:** evenly-spaced snapshots between `--since` and `--until`; reports per-step cluster changes with drift scores.
- Improved cluster labeling: keywords + path prefix (e.g. "search embed index (src/core)").
- Bugfix: empty `blobHashFilter` now returns empty snapshot (no division by zero).

**Deliverables:** `cluster-timeline` command, `ClusterTimelineStep`/`ClusterTimelineReport` types, tests.

---

### Phase 24 — Enhanced cluster labeling

**Version:** implemented in 0.22.0

**Goals:** Replace simple top-term labels with TF-IDF-weighted labels derived from path tokens and identifier splitting.

- New module: `src/core/search/labelEnhancer.ts` with TF-IDF, identifier splitting, noise filtering, and normalization.
- `ClusterInfo.enhancedKeywords` field populated when `--enhanced-labels` is supplied.
- `--enhanced-labels` / `--enhanced-keywords-n` flags on `clusters`, `cluster-diff`, `cluster-timeline`.

**Deliverables:** `labelEnhancer.ts`, enriched `ClusterInfo`, CLI flags, tests.

---

### Phase 25 — Interactive HTML visualizations

**Version:** implemented in 0.22.0

**Goals:** Add `--html [file]` output to cluster and concept-evolution commands.

- New module: `src/core/viz/htmlRenderer.ts` with four render functions:
  `renderClustersHtml`, `renderClusterDiffHtml`, `renderClusterTimelineHtml`, `renderConceptEvolutionHtml`.
- `safeJson()` helper escapes `<`, `>`, `&`, U+2028, U+2029 in embedded JSON to prevent XSS.
- `--html [file]` flag added to `clusters`, `cluster-diff`, `cluster-timeline`, `concept-evolution`.

**Deliverables:** `htmlRenderer.ts`, HTML output on all four commands, 19 unit tests.

---

### Phase 26 — CLI naming consolidation & conceptual diff

**Version:** implemented in 0.26.0

**Goals:** Promote `evolution` as the primary name for the concept-evolution command, introduce a
first-class `diff` command for semantic topic diffing across refs, and clean up the alias table.

#### Command naming changes

| Old primary | New primary | Backward-compat alias |
|---|---|---|
| `concept-evolution <query>` | `evolution <query>` | `concept-evolution` ✓ still works |
| `file-evolution <path>` | `file-evolution <path>` | *(no change)* |
| `file-diff <ref1> <ref2> <path>` | `file-diff <ref1> <ref2> <path>` | *(no change)* |

The former alias `evolution` → `file-evolution` and `diff` → `file-diff` are **removed**.
`semantic-blame` → `blame` is kept.

#### New `diff` command

`gitsema diff <ref1> <ref2> <query> [--top n] [--dump [file]]`

Computes a **conceptual/semantic diff** of a topic across two git refs using the existing
embedding index.  For each ref the set of blobs whose earliest-commit timestamp ≤ the ref
timestamp is determined.  Each group (gained / lost / stable) is then scored by cosine
similarity to the topic query and the top-k most relevant entries are reported.

New modules:
- `src/core/search/semanticDiff.ts` — `computeSemanticDiff()`, `SemanticDiffResult`, `SemanticDiffEntry`
- `src/cli/commands/semanticDiff.ts` — `semanticDiffCommand()`

#### Documentation

- `README.md` command table and alias notes updated.
- `gitsema --help` now shows `evolution` and `diff` under **Concept History**.

**Deliverables:** `evolution` as primary concept-evolution command, `diff` as new
conceptual-diff command, backward-compat alias for `concept-evolution`, updated docs, tests.

---

### Phase 27 — Semantic change-point detection

**Version:** implemented in 0.27.0

**Goals:** Detect sharp semantic shifts across Git history with commit-level granularity — a complement to the evolution and cluster timeline commands that surfaces *where* abrupt conceptual changes happened rather than showing a continuous drift.

Three new commands under the **Change Detection** group:

#### `gitsema change-points <query>`

Conceptual change points for a semantic query across the entire commit history.

- **Algorithm:** For each indexed commit `t` in chronological order:
  1. Determine the set of blobs visible as of `t` (blob first-seen timestamp ≤ commit timestamp).
  2. Score all visible blobs against `<query>` via cosine similarity (computed once, cached in memory).
  3. Take the top-k visible blobs by similarity score.
  4. Compute a weighted centroid `C_t` (weights = similarity scores) of the top-k embeddings.
  5. Compute `D_t = cosineDistance(C_{t-1}, C_t)`.
  6. Emit a change point at commit `t` when `D_t >= threshold`.
- Rank emitted points by `D_t` descending, return top `--top-points`.
- **Performance:** Embeddings are loaded once. Visible blobs are tracked with a pointer advancing through a blob list sorted by first-seen. For each commit, top-k selection scans the score-sorted list and stops after k visible hits.
- **Options:** `--top` (k, default 50), `--threshold` (default 0.3), `--top-points` (default 5), `--since`, `--until`, `--dump [file]`.
- **JSON output schema:** `type: "concept-change-points"`, `query`, `k`, `threshold`, `range: {since,until}`, `points: [{before,after,distance}]`.

#### `gitsema file-change-points <path>`

File-specific change points (semantic jumps) across a file's Git history.

- **Algorithm:** Reuses `computeEvolution(filePath)` (from Phase 6) to retrieve consecutive-version cosine distances. Emits a change point for each pair `(entry[i-1], entry[i])` where `entry[i].distFromPrev >= threshold`. Filters by `--since`/`--until` on the "after" entry timestamp.
- Rank by distance descending, return top `--top-points`.
- **Options:** `--threshold` (default 0.3), `--top-points` (default 5), `--since`, `--until`, `--dump [file]`.
- **JSON output schema:** `type: "file-change-points"`, `path`, `threshold`, `range`, `points: [{before:{commit,date,blobHash},after,distance}]`.

#### `gitsema cluster-change-points`

Detect change points in the repo's cluster structure.

- **Algorithm:** For each sampled commit `t`:
  1. Retrieve visible blobs via `getBlobHashesUpTo(timestamp)` (same as `cluster-timeline`).
  2. Skip if the visible blob set hasn't changed since the previous step (avoids redundant k-means runs).
  3. Run k-means clustering (`computeClusterSnapshot`) over visible blobs.
  4. Greedily match clusters to the previous step by centroid cosine similarity.
  5. Compute per-pair drift = `cosineDistance(matchedBefore.centroid, after.centroid)`.
  6. Compute mean centroid shift score `S_t = mean(drifts)`.
  7. Emit a change point when `S_t >= threshold`.
- Rank by `S_t` descending, return top `--top-points`.
- **Performance:** Running k-means at every commit can be expensive. Use `--max-commits` to cap the number of timestamps sampled (evenly spaced across the since–until range).
- **Options:** `--k` (default 8), `--threshold` (default 0.3), `--top-points` (default 5), `--since`, `--until`, `--max-commits`, `--dump [file]`.
- **JSON output schema:** `type: "cluster-change-points"`, `k`, `threshold`, `range`, `points: [{before,after,shiftScore,topMovingPairs:[{beforeLabel,afterLabel,drift}]}]`.

**Implementation notes:**
- Core logic lives in `src/core/search/changePoints.ts` (concept + file) and appended to `src/core/search/clustering.ts` (cluster change points).
- CLI handlers: `src/cli/commands/changePoints.ts`, `fileChangePoints.ts`, `clusterChangePoints.ts`.
- All three commands are added to the **Change Detection** group in the CLI help formatter.
- Tests in `tests/changePoints.test.ts` cover: empty-index handling, change-point detection above threshold, sorting, topPoints limit, since/until filtering, metadata correctness.

**Deliverables:** Three new CLI commands, JSON output schemas, tests, and updated README.

---

### Phase 28 — Persistent configuration management

**Version:** implemented in 0.28.0

**Goals:** Allow users to persist configuration values (embedding provider, model names, search defaults) in a JSON config file rather than relying solely on environment variables.

#### `gitsema config <action> [key] [value]`

Manages a two-tier configuration system (global `~/.config/gitsema/config.json` and local `.gitsema/config.json`). Local values take precedence over global; environment variables take precedence over both.

- **`set <key> <value>`** — Write a key to the active config file. Use `--global` to write to `~/.config/gitsema/config.json` (user-level); default is `.gitsema/config.json` (repo-level).
- **`get <key>`** — Show the resolved value and its source (`global`, `local`, or `env`).
- **`list`** — Show all active configuration values and their sources as a table.
- **`unset <key>`** — Remove a key from the config file.

**Supported keys** (dot-notation): `provider`, `model`, `text_model`, `code_model`, `http_url`, `api_key`, `verbose`, `log_max_bytes`, `serve_port`, `serve_key`, `remote`, `hooks.enabled`.

**Implementation notes:**
- `src/core/config/configManager.ts` — `loadConfig()`, `saveConfig()`, `resolveConfigValue()`, `applyConfigToEnv()`.
- `src/cli/commands/config.ts` — Commander subcommands wired to config manager.
- `applyConfigToEnv()` called at CLI startup in `src/cli/index.ts` so all downstream commands transparently pick up file-based defaults.
- Tests in `tests/config.test.ts`.

**Deliverables:** `config` CLI command, config file read/write, env-precedence merge, tests.

---

### Phase 29 — Automated indexing via Git hooks

**Version:** implemented in 0.28.0

**Goals:** Keep the semantic index up-to-date automatically after every local commit or merge, without requiring the user to run `gitsema index` manually.

- **`hooks.enabled`** config key — when `true`, `gitsema config set hooks.enabled true` installs symlinks for `post-commit` and `post-merge` into `.git/hooks/`.  Running `gitsema config set hooks.enabled false` removes them.
- The hook scripts call `gitsema index` (incremental, default options) so only new commits since the last run are processed.
- **`src/core/config/hookManager.ts`** — `installHooks()` / `uninstallHooks()` — creates and removes the symlinks.  Handles the case where a hook file already exists (appends a call rather than overwriting).
- Hook scripts live in `scripts/hooks/post-commit` and `scripts/hooks/post-merge`.
- README section added explaining how to opt in.

**Deliverables:** `hooks.enabled` config key, hookManager.ts, hook scripts, README guidance.

---

### Phase 30 — Commit message semantic indexing

**Version:** implemented in 0.29.0

**Goals:** Index not just *what* changed (blob content) but *why* it changed (the commit message), and expose that intent through search.  Links the semantic meaning of each commit to the code blobs it introduced.

#### Schema changes (v7)

New table `commit_embeddings`:
```sql
commit_hash TEXT PRIMARY KEY REFERENCES commits(commit_hash),
model TEXT NOT NULL,
dimensions INTEGER NOT NULL,
vector BLOB NOT NULL
```
One row per commit per model; populated by the indexer during Phase B (commit mapping).

#### Indexing changes

- `storeCommitEmbedding({ commitHash, model, embedding })` added to `src/core/indexing/blobStore.ts` — idempotent upsert (ON CONFLICT DO NOTHING), safe for re-index.
- Phase B of `runIndex()` now embeds each commit's message with the text provider immediately after `storeCommitWithBlobs()` returns.  Failures are non-fatal: logged and counted in the new `IndexStats.commitEmbeddings` / `commitEmbedFailed` fields.
- `gitsema index` summary line added: `Commit embeddings: N`.

#### Search

New `src/core/search/commitSearch.ts` exposes:

```ts
searchCommits(queryEmbedding, options?: { topK?, model? }): CommitSearchResult[]
// CommitSearchResult: { commitHash, score, message, timestamp, paths[] }
```

`gitsema search <query> --include-commits` runs commit-message search in parallel with the blob search and appends ranked commit results:

```
Commit matches:
0.847  a3f9c2d  2024-03-15  feat: add authentication token verification
       src/auth/jwt.ts
0.791  b19e4a1  2023-11-02  fix: validate token expiry on refresh
       src/auth/session.ts
```

**Implementation notes:**
- Only commits embedded after Phase 30 indexing will appear in commit search.
- Query always uses the text provider (natural-language prose), matching the existing search convention.
- Tests in `tests/commitEmbedding.test.ts` cover: storage idempotency, indexer integration, ranked search, empty-DB edge case, duplicate-free re-indexing.

**Deliverables:** `commit_embeddings` table (schema v7), `storeCommitEmbedding()`, Phase B embedding loop, `searchCommits()`, `--include-commits` flag on `search`, tests.

---

### Phase 31 — Semantic concept authorship ranking

**Version:** implemented in 0.30.0

**Goals:** Answer "who has contributed most to [concept]?" by aggregating vector similarity scores across commit authors — a people-centric view over the semantic index rather than a per-file or per-commit view.

#### `gitsema author <query>`

Ranks contributors by their semantic proximity to a concept across the full indexed history.

- **Algorithm:**
  1. Embed the query with the text provider.
  2. Rank all indexed blobs by cosine similarity to the query (top-K, default 50).
  3. For each top-K blob, join `blob_commits → commits` to find the **earliest** commit (original author attribution).
  4. Optionally filter by `--since <date>` Unix timestamp.
  5. Aggregate similarity scores by `(authorName, authorEmail)`.
  6. Return top-N sorted by total score.
- **Options:** `--top <n>` (default 10), `--since <date>`, `--detail` (per-file breakdown), `--dump [file]` (JSON output).
- Registered under the **Concept History** command group.

**Example output:**
```
Author contributions for: "rate limiting"

1. Jane Doe <jane@example.com>
   Score: 0.920  |  Blobs: 14
   · src/middleware/ratelimit.ts (14 blobs, score: 0.920)

2. John Smith <john@example.com>
   Score: 0.450  |  Blobs: 3
   · src/api/config.ts (3 blobs, score: 0.450)
```

**Schema changes (v8):**
- Added `author_name TEXT` and `author_email TEXT` (nullable) to the `commits` table.
- Migration guard uses `PRAGMA table_info` before `ALTER TABLE` — safe for both fresh and existing DBs.

**Git parsing changes (`commitMap.ts`):**
- Switched `git log` format to use ASCII 31 unit separator (`%x1f`) to safely capture author fields containing spaces: `COMMIT %H%x1f%ct%x1f%aN%x1f%aE%x1f%s`
- `CommitEntry` gains optional `authorName` and `authorEmail` fields.

**Implementation notes:**
- Core logic in `src/core/search/authorSearch.ts` — `computeAuthorContributions(queryEmbedding, options)`.
- `storeCommitWithBlobs` in `blobStore.ts` persists `author_name`/`author_email` in both insert paths.
- Tests in `tests/authorSearch.test.ts` cover: empty-index, score aggregation, top-N limit, since-filtering, per-file detail output.

**Deliverables:** `gitsema author` CLI command, `authorSearch.ts` core module, schema v8 migration, `commitMap.ts` author parsing, tests.

---

### Phase 32 — Branch and merge awareness

**Version:** implemented in 0.31.0

**Goals:** Surface semantic conflicts and concept-level changes that exist between branches but are invisible to textual `git diff`.  The core insight: the `blob_branches` table records *reachability* (all blobs ever on a branch) but not *exclusivity* (blobs first introduced by a branch since it diverged).  All three commands in this phase pivot on branch-exclusive blobs.

#### New Git primitive: `src/core/git/branchDiff.ts`

- **`getMergeBase(branchA, branchB, repoPath?)`** — wraps `git merge-base <A> <B>` (`execFileSync`); returns the 40-character merge-base commit hash.  Foundation for all three commands.
- **`getBranchExclusiveBlobs(branch, mergeBaseHash, repoPath?)`** — runs `git log <mergeBase>..<branch> --format=%H` to list commits exclusive to the branch, then batch-queries the existing `blob_commits` table (`SELECT DISTINCT blob_hash FROM blob_commits WHERE commit_hash IN (...)`) in batches of 500.  Returns the set of indexed blob hashes first introduced by the branch.  No schema changes required — `blob_commits` already records every (blob, commit) pair.

#### `gitsema merge-audit <branch-a> <branch-b>`

Detects **semantic collisions** between two branches: file pairs from opposite branches that are about the same concept (cosine similarity ≥ threshold) even when they don't share a single line of code.

- **Algorithm (`computeSemanticCollisions` in `src/core/search/mergeAudit.ts`):**
  1. Compute `getMergeBase(A, B)`.
  2. Compute `getBranchExclusiveBlobs(A, mergeBase)` and `getBranchExclusiveBlobs(B, mergeBase)`.
  3. Load embeddings for both sets.
  4. O(|A|×|B|) cosine comparison; collect pairs above `threshold`.
  5. Look up `cluster_assignments` to group collision pairs into **collision zones** by concept cluster.
  6. Compute `centroid_A = mean(embeddings_A)` and `centroid_B = mean(embeddings_B)`; report `cosineSimilarity(centroid_A, centroid_B)` as a branch-level overlap score.
- **Options:** `--base <ref>` (override merge base), `--threshold <n>` (default 0.85), `-k, --top <n>` (default 20), `--dump [file]`.
- **Output includes:** centroid similarity interpretation label (LOW / MODERATE / HIGH / VERY HIGH), collision zones grouped by cluster, top-K pairs with similarity scores.

#### `gitsema branch-summary <branch>`

Generates a semantic description of what a branch "is about" compared to its base.

- **Algorithm (`computeBranchSummary` in `src/core/search/branchSummary.ts`):**
  1. Resolve merge base; collect branch-exclusive blobs.
  2. Load embeddings; compute unweighted branch centroid.
  3. Score every stored cluster (`blob_clusters`) by `cosineSimilarity(branchCentroid, clusterCentroid)`; return top-K nearest as "this branch is about…".
  4. For each file path touched by the branch, run `computeEvolution(path)` and report `distFromPrev` of the latest version as per-file semantic drift.
- **Options:** `--base <branch>` (default `main`), `-k, --top <n>` (default 5 clusters), `--dump [file]`.

#### `gitsema merge-preview <branch>`

Predicts how the concept landscape will shift after merging the branch — i.e. "cluster-diff but driven by branch-exclusive blobs instead of timestamps."

- **Algorithm (`computeMergeImpact` in `src/core/search/mergeAudit.ts`):**
  1. Get merge base and branch-exclusive blobs.
  2. Compute base-branch blobs via `getBlobHashesUpTo(resolveRefToTimestamp(baseBranch))`.
  3. `snapshot_before = computeClusterSnapshot({ blobHashFilter: baseBranchBlobs })`.
  4. `snapshot_after = computeClusterSnapshot({ blobHashFilter: [...baseBranchBlobs, ...branchExclusiveBlobs] })`.
  5. Return `compareClusterSnapshots(snapshot_before, snapshot_after, baseBranch, branch)` — identical result type to `cluster-diff` (`TemporalClusterReport`), zero new types required.
- **Options:** `--into <branch>` (default `main`), `--k <n>` (default 8), `--dump [file]`, `--html [file]` (reuses `renderClusterDiffHtml` unchanged).

#### MCP tools

`branch_summary`, `merge_audit`, `merge_preview` added to `src/mcp/server.ts` as thin adapters (same parameter surface as the CLI counterparts, following the CLI-first design constraint).

**Implementation notes:**
- No schema changes — the existing `blob_commits`, `blob_branches`, `blob_clusters`, and `cluster_assignments` tables provide all required data.
- All three commands registered under the **Cluster Analysis** group in the CLI help formatter.
- Tests in `tests/branchDiff.test.ts` (5 tests), `tests/mergeAudit.test.ts` (12 tests), `tests/branchSummary.test.ts` (7 tests).

**Deliverables:** `src/core/git/branchDiff.ts`, `src/core/search/mergeAudit.ts`, `src/core/search/branchSummary.ts`, three CLI command files, three MCP tools, 24 unit tests.

---

### Phase 33 — Multi-level hierarchical indexing

**Version:** implemented in 0.32.0

**Goals:** Fix a critical silent data-loss bug where `--chunker function` and `--chunker fixed` never populated the `embeddings` table, breaking `search`, `evolution`, `clusters`, `dead-concepts`, `impact`, and `semantic-diff` for anyone who indexed with a non-default chunker. Additionally, introduce Level-3 module (directory) centroid embeddings for coarse semantic search over entire modules.

#### Root cause of Level-1 regression

`indexer.ts` branched hard on `chunkerStrategy !== 'file'` and called `storeBlobRecord` (blob record, no embedding) in the chunking path, skipping the `embeddings` table entirely. All downstream features that query `embeddings` silently returned empty results.

#### Three indexing levels

| Level | Table | When populated |
|---|---|---|
| 1 — Whole-file | `embeddings` | Always (all chunker strategies) |
| 2a — Fixed chunks | `chunk_embeddings` | `--chunker fixed` or `--chunker function` |
| 2b — Symbol | `symbol_embeddings` | `--chunker function` |
| 3 — Module centroid | `module_embeddings` | Always (inline running mean) |

#### Level-1 fix (`src/core/indexing/indexer.ts`)

The chunking branch now always computes a whole-file embedding first via `storeBlob` (writes blob + embedding + path + FTS5 in one call), then runs the chunk/symbol loop. Falls back to `storeBlobRecord` only if the whole-file embed fails (e.g. provider error or context overflow). The `chunkId` returned by `storeChunk` is now forwarded to `storeSymbol`, adding the `chunk_id` FK link.

#### Level-3 module embeddings

New `module_embeddings` table stores one directory-centroid vector per module path, computed as the running arithmetic mean of all Level-1 blob vectors in that directory. Updated inline during indexing via `storeModuleEmbedding()` / `getModuleEmbedding()` in `blobStore.ts`.

The `computeModuleEmbedding` option on `IndexerOptions` (default `true`) controls whether inline updates are performed.

#### Schema changes (v8 → v9)

- `module_embeddings` table (directory centroid, `module_path UNIQUE`, `blob_count`)
- Nullable `chunk_id` on `symbols` (FK → `chunks.id`, enforced at application level; guarded `ALTER TABLE` with `PRAGMA table_info` check for existing DBs)

#### New CLI: `gitsema update-modules`

Batch recalculates all module centroids from existing whole-file embeddings (equivalent to a Level-3 full rebuild). Useful after model changes or migrating pre-Phase-33 indexes.

#### `--level` flag on `search`

```
gitsema search <query> --level <file|chunk|symbol|module>
```

Maps to `searchChunks`, `searchSymbols`, `searchModules` flags in `vectorSearch`. Module results carry `modulePath` on `SearchResult`. The existing `--chunks` flag is retained for backward compatibility.

**Implementation notes:**
- `computeModuleEmbedding` defaults to `true`; set to `false` to skip both the whole-file and module updates (useful when only chunk/symbol embeddings are needed).
- Module centroid upsert uses `INSERT OR REPLACE` with a sub-select to preserve the row `id`.
- `IndexStats.moduleEmbeddings` counts module centroid rows updated per indexing run.
- 5 integration tests in `tests/moduleEmbeddings.test.ts`.

**Deliverables:** `src/core/db/schema.ts` (schema v9), `src/core/db/sqlite.ts` (migration v8→v9), `src/core/indexing/blobStore.ts` (module embedding helpers), `src/core/indexing/indexer.ts` (Level-1 fix + module updates), `src/core/search/vectorSearch.ts` (`searchModules` option), `src/core/models/types.ts` (`modulePath` on `SearchResult`), `src/cli/commands/updateModules.ts`, `src/cli/commands/search.ts` (`--level` flag), 5 unit tests, `docs/plant.md`.

---

### Phase 34 — Feature adoption & cross-cutting improvements

**Version:** 0.33.0

A comprehensive cross-cutting feature-adoption pass based on a systematic review of all 27 CLI commands against 8 newer capabilities (hybrid search, commit embeddings, symbol-level search, module-level search, branch filtering, HTML output, query cache, enhanced cluster labels).

#### Priority 1 — Quick wins (< 1 hr)

- **`src/core/embedding/providerFactory.ts`** (new) — `buildProvider`, `getTextProvider`, `getCodeProvider` extracted from 9 identical local functions across CLI commands and the MCP server.
- **`src/core/embedding/embedQuery.ts`** (new) — cache-aware `embedQuery()` shared helper; adopted in `search`, `first-seen`, `author`, `change-points`, `concept-evolution`, `diff`, and all 4 MCP query-embedding tools.
- **`--dump [file]`** added to `search` and `first-seen`.
- **`--branch <name>`** added to `first-seen`.

#### Priority 2 — Incremental (1–3 hrs)

- **`--branch <name>`** added to `author`, `dead-concepts`, `impact`, `concept-evolution`, `change-points`, `clusters`, `cluster-diff`, `cluster-timeline`, `cluster-change-points`.
- **`--hybrid` + `--bm25-weight`** added to `first-seen` and `author`.
- **`--include-commits`** added to `first-seen`.
- **`--enhanced-labels`** added to `cluster-change-points`, `branch-summary`, `merge-audit`.
- New `getBranchBlobHashSet()` in `vectorSearch.ts` and `getBlobHashesOnBranch()` in `clustering.ts`.

#### Priority 3 — Medium effort (3–8 hrs)

- **`--html [file]`** added to 7 commands: `file-evolution`, `change-points`, `file-change-points`, `cluster-change-points`, `dead-concepts`, `merge-audit`, `branch-summary`. Seven new render functions in `src/core/viz/htmlRenderer.ts`.
- **`--level symbol`** added to `impact` and `blame`. `computeImpact` and `computeSemanticBlame` extended with `searchSymbols` option.
- **Extended `status` output** — row counts for `chunks`, `chunk_embeddings`, `symbols`, `symbol_embeddings`, `commit_embeddings`, `module_embeddings`.

#### Priority 4 — Larger effort (> 3 hrs)

- **`--annotate-clusters`** on `search` — joins `cluster_assignments`/`blob_clusters` after search; adds `clusterLabel` to `SearchResult`; shown in `renderResults` and `--dump` JSON.
- **`--level symbol`** on `file-evolution` and `file-change-points` — `computeEvolution` computes per-symbol embedding centroids when `useSymbolLevel=true`; threaded through `computeFileChangePoints`.
- **5 new MCP tools** (item 15): `clusters`, `change_points`, `author`, `impact`, `dead_concepts`.
- **HTTP analysis routes** (item 16): `POST /api/v1/analysis/clusters`, `/change-points`, `/author`, `/impact` — new `src/server/routes/analysis.ts` + wired into `app.ts`.

**Deliverables:** `src/core/embedding/providerFactory.ts`, `src/core/embedding/embedQuery.ts`, updated CLI commands (18 files), `src/core/viz/htmlRenderer.ts` (7 new render fns), `src/core/models/types.ts` (`clusterLabel` on `SearchResult`), `src/core/search/evolution.ts` (`useSymbolLevel`), `src/core/search/changePoints.ts` (`useSymbolLevel`), `src/mcp/server.ts` (5 new tools, 14 total), `src/server/routes/analysis.ts` (new), `src/server/app.ts`, `docs/review.md`.

---

### Phase 35 — Multi-model DB, per-command model flags, clear-model, multi-model search

**Version:** 0.34.0

**Goal:** The DB schema now supports multiple embeddings per blob (one per model), model selection is available as per-command CLI flags, and search automatically leverages both models when text and code models differ.

**Schema change (v10):** Rebuilt 5 embedding tables with composite primary/unique keys on `(hash, model)`:
- `embeddings`: PK `(blob_hash, model)` — was `blob_hash` only
- `chunk_embeddings`: PK `(chunk_id, model)` — was `chunk_id` only
- `symbol_embeddings`: PK `(symbol_id, model)` — was `symbol_id` only
- `commit_embeddings`: PK `(commit_hash, model)` — was `commit_hash` only
- `module_embeddings`: UNIQUE `(module_path, model)` — was `module_path` only

Migration rebuilds each table (with `PRAGMA foreign_keys = OFF/ON`) and copies existing data. Fully backward-compatible.

**Deduplication change:** `isIndexed(blobHash, model)` checks `(blob_hash, model)` in `embeddings`. A blob indexed with model A is NOT skipped when indexing with model B. `filterNewBlobs(hashes, model)` similarly filters by model.

**New modules:**
- `src/core/embedding/providerFactory.ts` — `applyModelOverrides(opts)` helper that applies `--model` / `--text-model` / `--code-model` CLI flag values to `process.env` before provider construction.
- `src/cli/commands/clearModel.ts` — `gitsema clear-model <model> [--yes]` command.

**CLI changes:**
- `--model`, `--text-model`, `--code-model` flags added to: `index`, `search`, `first-seen`, `evolution`, `concept-evolution`, `diff`, `clusters`.
- `gitsema clear-model <model>` registered in the Setup & Infrastructure group.

**Multi-model search:** When `GITSEMA_TEXT_MODEL ≠ GITSEMA_CODE_MODEL` (or overridden via flags), the `search` command embeds the query with both providers, runs two independent `vectorSearch()` calls (each filtered to its model), and merges results via `mergeSearchResults()` (highest score wins per blob).

**Status warning:** `gitsema status` now queries `SELECT DISTINCT model FROM embeddings` and warns when the configured text/code model(s) are absent from the DB, with a suggestion to re-index or run `gitsema clear-model <old-model>`.

**Documentation:**
- `docs/model-stores.md` fully updated with Phase 35 coverage.
- `docs/plan_vss.md` created: Phase 36 plan for int8 quantization + ANN index (sqlite-vss/usearch).
- `docs/index.md` updated.

**Deliverables:** `src/core/db/schema.ts`, `src/core/db/sqlite.ts` (migration v10), `src/core/indexing/deduper.ts`, `src/core/indexing/blobStore.ts`, `src/core/indexing/indexer.ts`, `src/core/embedding/providerFactory.ts`, `src/cli/commands/clearModel.ts`, `src/cli/commands/status.ts`, `src/cli/commands/search.ts`, 6 other CLI commands, `src/cli/index.ts`, `docs/model-stores.md`, `docs/plan_vss.md`, `docs/index.md`.

---

### Phase 36 — Vector Index (VSS), Int8 Quantization, ANN Search

**Version:** 0.35.0

**Goal:** Add optional per-vector int8 scalar quantization to reduce storage size and enable fast approximate nearest-neighbour (ANN) search via HNSW (usearch VSS). Provide tooling to build and query a usearch index from stored embeddings; keep full backward compatibility with existing float32 vectors.

**Schema change (v11):** Add quantization metadata to embedding tables:
- `quantized INTEGER DEFAULT 0` — 1 when vector BLOB stores Int8 quantized bytes, 0 otherwise
- `quant_min REAL` — minimum value used for per-vector scaling
- `quant_scale REAL` — scale factor mapping [0..255] → original range

Migration adds these columns idempotently to: `embeddings`, `chunk_embeddings`, `symbol_embeddings`, `commit_embeddings`.

**New module:** `src/core/embedding/quantize.ts` — implements Int8 scalar quantization, dequantization, and serialization helpers.

**Indexer changes:**
- New `quantize?: boolean` `IndexerOptions` field and CLI flag passthrough.
- When enabled, indexer stores quantized vectors (Int8 BLOB) in the DB and sets quantization metadata. Otherwise stores legacy Float32Array blobs.

**Blob store changes:** `storeBlob`, `storeChunk`, `storeSymbol`, `storeCommitEmbedding` accept `quantize?: boolean` and write quantization columns when appropriate.

**Search changes:** `vectorSearch` transparently detects quantized rows and dequantizes them in-memory before scoring, preserving backward compatibility.

**CLI additions:**
- `gitsema build-vss` — builds a usearch HNSW index from stored embeddings and writes `.gitsema/vectors-<model>.usearch` and `.gitsema/vectors-<model>.map.json`.
- `gitsema search --vss` (optional) attempts ANN search via a local usearch index; falls back to linear scan when the index is absent or `usearch` is not installed.
- `gitsema index --quantize` (optional) instructs the indexer to quantize vectors when storing them. `gitsema index --build-vss` optionally invokes `build-vss` after indexing completes.

**Optional dependency:** `usearch` added as an optional dependency so users without the package can still run the core tool; `build-vss` and `search --vss` will prompt/errors gracefully if missing.

**Docs & tests:**
- `tests/quantize.test.ts` — unit tests for quantize/dequantize/serialize round-trips and quality assertions.
- `docs/PLAN.md` updated (this entry).

**Deliverables:** `src/core/embedding/quantize.ts`, `src/core/db/schema.ts` (new columns), `src/core/db/sqlite.ts` (v11 migration + initTables update), `src/core/indexing/blobStore.ts`, `src/core/indexing/indexer.ts`, `src/core/search/vectorSearch.ts`, `src/cli/commands/buildVss.ts`, `src/cli/commands/search.ts` (vss option), `src/cli/commands/index.ts` (quantize/buildVss flags), `package.json` optionalDependencies update, `tests/quantize.test.ts`.

---

**Version:** 0.34.0

**Goal:** The DB schema now supports multiple embeddings per blob (one per model), model selection is available as per-command CLI flags, and search automatically leverages both models when text and code models differ.

**Schema change (v10):** Rebuilt 5 embedding tables with composite primary/unique keys on `(hash, model)`:
- `embeddings`: PK `(blob_hash, model)` — was `blob_hash` only
- `chunk_embeddings`: PK `(chunk_id, model)` — was `chunk_id` only
- `symbol_embeddings`: PK `(symbol_id, model)` — was `symbol_id` only
- `commit_embeddings`: PK `(commit_hash, model)` — was `commit_hash` only
- `module_embeddings`: UNIQUE `(module_path, model)` — was `module_path` only

Migration rebuilds each table (with `PRAGMA foreign_keys = OFF/ON`) and copies existing data. Fully backward-compatible.

**Deduplication change:** `isIndexed(blobHash, model)` checks `(blob_hash, model)` in `embeddings`. A blob indexed with model A is NOT skipped when indexing with model B. `filterNewBlobs(hashes, model)` similarly filters by model.

**New modules:**
- `src/core/embedding/providerFactory.ts` — `applyModelOverrides(opts)` helper that applies `--model` / `--text-model` / `--code-model` CLI flag values to `process.env` before provider construction.
- `src/cli/commands/clearModel.ts` — `gitsema clear-model <model> [--yes]` command.

**CLI changes:**
- `--model`, `--text-model`, `--code-model` flags added to: `index`, `search`, `first-seen`, `evolution`, `concept-evolution`, `diff`, `clusters`.
- `gitsema clear-model <model>` registered in the Setup & Infrastructure group.

**Multi-model search:** When `GITSEMA_TEXT_MODEL ≠ GITSEMA_CODE_MODEL` (or overridden via flags), the `search` command embeds the query with both providers, runs two independent `vectorSearch()` calls (each filtered to its model), and merges results via `mergeSearchResults()` (highest score wins per blob).

**Status warning:** `gitsema status` now queries `SELECT DISTINCT model FROM embeddings` and warns when the configured text/code model(s) are absent from the DB, with a suggestion to re-index or run `gitsema clear-model <old-model>`.

**Documentation:**
- `docs/model-stores.md` fully updated with Phase 35 coverage.
- `docs/plan_vss.md` created: Phase 36 plan for int8 quantization + ANN index (sqlite-vss/usearch).
- `docs/index.md` updated.

**Deliverables:** `src/core/db/schema.ts`, `src/core/db/sqlite.ts` (migration v10), `src/core/indexing/deduper.ts`, `src/core/indexing/blobStore.ts`, `src/core/indexing/indexer.ts`, `src/core/embedding/providerFactory.ts` (`applyModelOverrides`), `src/cli/commands/clearModel.ts` (new), `src/cli/commands/status.ts`, `src/cli/commands/search.ts` (multi-model), 6 other CLI commands, `src/cli/index.ts`, `docs/model-stores.md`, `docs/plan_vss.md`, `docs/index.md`.

---

### Phase 37 — Quick Wins: Selective Indexing, Code-to-Code Search, Negative Examples, Result Explanation

**Version:** 0.38.0

**Goal:** Four high-value, low-complexity features that improve the day-to-day indexing and search experience.

**Features implemented:**

**Partial/Selective Indexing (Globs):** Added `--include-glob <patterns>` flag to `gitsema index`. Accepts comma-separated minimatch-style patterns (e.g., `"src/**/*.ts,tests/**"`). Only blobs whose path matches at least one pattern are indexed. Composable with existing `--ext` and `--exclude` filters.

- `src/core/indexing/indexer.ts` — added `includeGlob?: string[]` to `FilterOptions`; applies minimatch per-blob in `isFiltered()`
- `src/cli/commands/index.ts` — parses `--include-glob` option and threads it into filter for both local and remote index paths
- `src/cli/index.ts` — exposes `--include-glob` flag on the index command
- `package.json` — adds `minimatch ^9.0.0` dependency

**Code-to-Code Search:** (`gitsema code-search <path>`) — already implemented in prior phases via `src/cli/commands/codeSearch.ts`.

**Negative Examples Search:** (`--not-like <query>` on `gitsema search`) — already implemented in prior phases.

**Result Explanation:** (`--explain` on `gitsema search`) — already implemented in prior phases.

**Deliverables:** `src/core/indexing/indexer.ts`, `src/cli/commands/index.ts`, `src/cli/index.ts`, `package.json`.

---

### Phase 38 — Medium Effort: Documentation Gap Analysis, Semantic Bisect, GC, Boolean Queries

**Version:** 0.39.0

**Goal:** Four medium-effort, high-impact features improving the analysis and maintenance capabilities.

**Features implemented:**

**Documentation Gap Analysis:** New `gitsema doc-gap` command. For each indexed code blob, computes its maximum cosine similarity to any indexed documentation blob (`.md`, `.txt`, `.rst`, etc.). Returns results sorted ascending by similarity — the lowest-scored files are the least documented. Flags: `--top <n>`, `--threshold <n>`, `--branch <name>`, `--dump [file]`.

- `src/core/search/docGap.ts` — `computeDocGap()` core implementation: classifies blobs by `getFileCategory()`, loads doc embeddings, computes per-code-blob max similarity, sorts ascending
- `src/cli/commands/docGap.ts` — CLI wrapper
- `src/cli/index.ts` — registers `doc-gap` command
- `tests/docGap.test.ts` — unit test verifying ranking order

**Semantic Git Bisect:** (`gitsema bisect <good> <bad> <query>`) — already implemented in prior phases via `src/cli/commands/semanticBisect.ts`.

**Garbage Collection:** (`gitsema gc` / `gitsema vacuum`) — already implemented in prior phases via `src/core/indexing/gc.ts`.

**Boolean/Composite Queries:** (`--and`/`--or` on `gitsema search`) — already implemented in prior phases via `src/core/search/booleanSearch.ts`.

**Deliverables:** `src/core/search/docGap.ts`, `src/cli/commands/docGap.ts`, `src/cli/index.ts`, `tests/docGap.test.ts`.

---

### Phase 39 — Analysis Features: Contributor Profiles, Refactoring, Lifecycle, CI Diff

**Version:** 0.40.0

**Goal:** Deeper codebase analysis commands for understanding contributor specialization, refactoring opportunities, concept lifecycle, and CI semantic diffs.

**Features implemented:**

**Contributor Semantic Profiles:** New `gitsema contributor-profile <author>` command. Finds all commits by the given author (substring match against `author_name` / `author_email`), collects the blobs touched by those commits, computes the centroid embedding, and returns top-N most similar blobs representing the contributor's semantic specialization. Flags: `--top <n>`, `--branch <name>`, `--dump [file]`.

- `src/core/search/contributorProfile.ts` — `computeContributorProfile()` core logic: author lookup, blob collection, centroid computation, vector search
- `src/cli/commands/contributorProfile.ts` — CLI wrapper
- `src/cli/index.ts` — registers `contributor-profile` command
- `tests/contributorProfile.test.ts` — unit test verifying centroid and result

**Refactoring Suggestions:** (`gitsema refactor-candidates`) — already implemented in prior phases via `src/cli/commands/refactorCandidates.ts`.

**Concept Lifecycle Analysis:** (`gitsema lifecycle <query>`) — already implemented in prior phases via `src/cli/commands/conceptLifecycle.ts`.

**CI/CD Semantic Diff in PRs:** (`gitsema ci-diff`) — already implemented in prior phases via `src/cli/commands/ciDiff.ts`.

**Deliverables:** `src/core/search/contributorProfile.ts`, `src/cli/commands/contributorProfile.ts`, `src/cli/index.ts`, `tests/contributorProfile.test.ts`.

---

### Phase 40 — Visualization & Scale: Codebase Map, Temporal Heatmap, Remote Index, Cherry-Pick

**Version:** 0.41.0

**Goal:** Visualization-oriented and scale-focused features providing an overview of the codebase's semantic structure, temporal activity, and commit reuse opportunities.

**Features implemented:**

**Semantic Codebase Map:** New `gitsema map` command. Outputs a JSON representation of semantic clusters and their blob assignments using the existing `blob_clusters` / `cluster_assignments` tables (no heavy UMAP/t-SNE dependency required). Intended as a machine-readable codebase map for downstream tooling.

- `src/cli/commands/map.ts` — `mapCommand()`
- `src/cli/index.ts` — registers `map` command

**Temporal Heatmap:** New `gitsema heatmap [--period week|month]` command. Counts the number of distinct blob-level changes (unique blob hashes introduced) per time period by querying `blob_commits ⋈ commits`. Useful for identifying periods of high semantic activity.

- `src/cli/commands/heatmap.ts` — `heatmapCommand()` with `--period` and `--dump` flags
- `src/cli/index.ts` — registers `heatmap` command

**Semantic Cherry-Pick Suggestions:** New `gitsema cherry-pick-suggest <query>` command. Embeds the query using the configured text model and searches `commit_embeddings` to return the top-N commits most semantically similar to the query — candidates for cherry-picking into another branch. Flags: `--top <n>`, `--model <model>`, `--dump [file]`.

- `src/core/search/cherryPick.ts` — `suggestCherryPicks()` delegating to `searchCommits()`
- `src/cli/commands/cherryPickSuggest.ts` — CLI wrapper
- `src/cli/index.ts` — registers `cherry-pick-suggest` command
- `tests/cherryPick.test.ts` — unit test

**Remote Index Sharing:** (`gitsema serve` + `gitsema remote-index`) — already implemented in prior phases.

**Deliverables:** `src/cli/commands/map.ts`, `src/cli/commands/heatmap.ts`, `src/core/search/cherryPick.ts`, `src/cli/commands/cherryPickSuggest.ts`, `src/cli/index.ts`, `tests/cherryPick.test.ts`.

---

### Phase 41 — Multi-Repo Unified Index *(completed v0.43.0)*

**Goal:** Implement a multi-repository registry so gitsema can track and query across multiple repos. Adds cross-repo provenance to blobs and a CLI surface for managing registered repositories.

**Implemented scope:**
- Added `repos` table (id, name, url, addedAt) to the SQLite schema (v14) and migration.
- Implemented a small repo registry: `src/core/indexing/repoRegistry.ts` with `add`, `list`, and `get` helpers.
- CLI integration: `gitsema repos add|list|remove` via `src/cli/commands/repos.ts`; registered in `src/cli/index.ts`.
- Unit tests: `tests/multiRepo.test.ts`.

**Deliverables:** `src/core/indexing/repoRegistry.ts`, `src/cli/commands/repos.ts`, `src/cli/index.ts`, `tests/multiRepo.test.ts`.

**Status:** ✅ complete.

---

### Phase 42 — IDE / LSP Integration *(completed v0.44.0)*

**Goal:** Expose gitsema's semantic index as an LSP server so IDEs can offer inline semantic search, related-code navigation, and concept-history hover cards.

**Implemented scope:**
- Minimal JSON-RPC LSP server (stdio framing) implemented in `src/core/lsp/server.ts`.
- CLI command `src/cli/commands/lsp.ts` to start the server; registered in `src/cli/index.ts`.
- Helpers for parsing/serialising LSP messages; handlers for `initialize` and `textDocument/hover`.
- Unit tests: `tests/lsp.test.ts` (framing and initialize handler).

**Deliverables:** `src/core/lsp/server.ts`, `src/cli/commands/lsp.ts`, `src/cli/index.ts`, `tests/lsp.test.ts`.

**Status:** ✅ complete (hover only at this phase; definition/references/workspace-symbol extended in Phase 51).

---

### Phase 43 — Security Pattern Detection *(completed v0.45.0)*

**Goal:** Combine semantic similarity with a curated pattern list to flag code blobs matching known vulnerability patterns (SQL injection, path traversal, insecure deserialization, etc.).

**Implemented scope:**
- `src/core/search/securityScan.ts` implements `scanForVulnerabilities` using a small curated pattern list and vector search.
- CLI integration: `gitsema security-scan` via `src/cli/commands/securityScan.ts`; registered in `src/cli/index.ts`.
- Unit tests: `tests/securityScan.test.ts`.

**Deliverables:** `src/core/search/securityScan.ts`, `src/cli/commands/securityScan.ts`, `src/cli/index.ts`, `tests/securityScan.test.ts`.

**Status:** ✅ complete.

---

### Phase 44 — Codebase Health Timeline *(completed v0.46.0)*

**Goal:** Provide a time-series of composite health metrics (semantic churn, coverage proxy, complexity proxy, dead-concept ratio) as a structured CLI export.

**Implemented scope:**
- `src/core/search/healthTimeline.ts` provides `computeHealthTimeline` producing time-bucketed health snapshots.
- CLI integration: `gitsema health` via `src/cli/commands/health.ts`; registered in `src/cli/index.ts`.
- Unit tests: `tests/healthTimeline.test.ts`.

**Deliverables:** `src/core/search/healthTimeline.ts`, `src/cli/commands/health.ts`, `src/cli/index.ts`, `tests/healthTimeline.test.ts`.

**Status:** ✅ complete.

---

### Phase 45 — Technical Debt Scoring *(completed v0.47.0)*

**Goal:** Score each blob by how semantically "isolated" it is, how old it is, and how infrequently it changes. High scores indicate candidates for refactoring or removal.

**Implemented scope:**
- `src/core/search/debtScoring.ts` exposes `scoreDebt` (async) computing a composite debt score over blobs using three signals: age, inverse change-frequency, and isolation.
- Isolation score uses real computation: HNSW VSS path (O(log N), via usearch index built by `gitsema build-vss`) preferred; cosine scan fallback (O(N²)) when no index file exists; falls back to 0.5 only for blobs with no stored embedding.
- `computeIsolationCosineScan` is exported and unit-tested (identical vectors → 0, orthogonal → 1, single blob → 0.5).
- CLI integration: `gitsema debt` via `src/cli/commands/debt.ts`; registered in `src/cli/index.ts`.
- Unit tests: `tests/debtScoring.test.ts`.

**Deliverables:** `src/core/search/debtScoring.ts`, `src/cli/commands/debt.ts`, `src/cli/index.ts`, `tests/debtScoring.test.ts`.

**Status:** ✅ complete.

---

### Phase 46 — Evolution Alerts and Commit URL Construction *(completed v0.48.0)*

**Goal:** Surface actionable alerts from the evolution timeline and produce clickable commit links for GitHub/GitLab/Bitbucket.

**Implemented scope:**
- `src/core/search/evolution.ts` extended with `buildCommitUrl` (GitHub/GitLab/Bitbucket support) and `extractAlerts` for salient timeline jumps.
- CLI evolution commands now accept `--alerts`; commit URL resolution via `git remote get-url origin`.
- Unit tests: `tests/evolutionAlerts.test.ts` (commit URL building and alert extraction).

**Deliverables:** `src/core/search/evolution.ts`, `tests/evolutionAlerts.test.ts`.

**Status:** ✅ complete.

---

### Phase 47 — Richer Indexing Progress, Embed Latency Stats, and Incremental-by-Default Messaging

**Goal:** Make `gitsema index` output far more informative and actionable. Users running long indexing jobs had no visibility into which pipeline stage was running, how fast embeddings were processing, or whether they were in incremental or full-rebuild mode.

**Progress counter improvements:**
- `formatElapsed(ms)` — human-friendly duration formatter exported from `src/cli/commands/index.ts`: `234ms` → `12.3s` → `2m 05s` → `1h 02m 03s`
- `renderProgress()` rewritten to show current stage label (`[collecting]`, `[embedding]`, `[commit-mapping]`), progress bar with count and percentage, throughput (blobs/s), embedding latency avg + p95, and ETA
- Final summary extended with per-stage wall-clock timings (collection / embedding / commit-mapping) and embedding latency stats

**Indexer instrumentation (`src/core/indexing/indexer.ts`):**
- New `IndexStats` fields: `currentStage`, `stageTimings`, `embedLatencyAvgMs`, `embedLatencyP95Ms`
- Stage transitions recorded with timestamps throughout `runIndex()`
- Embedding calls wrapped in `timedEmbed()` helper; latency collected in a rolling 200-sample window
- avg/p95 computed lazily on progress ticks (not per-embed call) via dirty-flag pattern to avoid O(n log n) sort overhead in the hot path

**Incremental mode messaging:**
- CLI prints the active mode at run start: `Mode: incremental (resuming from <hash>)`, `Mode: full (no prior index found)`, `Mode: incremental from <ref>`, or `Mode: full re-index (--since all)`

**CLI help text improvements (`src/cli/index.ts`):**
- `gitsema index --help` description updated with incremental-default explanation, progress metric glossary, and performance tuning tips
- Option descriptions improved for `--since`, `--concurrency`, `--chunker`, `--window-size`, and model override flags

**Tests:** `tests/indexProgress.test.ts` — 4 unit tests for `formatElapsed` covering all formatting tiers.

**Version:** 0.49.0

**Deliverables:** `src/cli/commands/index.ts`, `src/cli/index.ts`, `src/core/indexing/indexer.ts`, `tests/indexProgress.test.ts`.

---

### Phase 48 — Batch Embedding and Provider Throughput ✅ Implemented

**Goal:** Close the longstanding C6 gap; enable practical indexing of large repos against local HTTP providers.

- Added `--embed-batch-size <n>` option to `gitsema index`.
- When `--chunker file` (default), the provider implements `embedBatch`, and no routing provider is active, blobs are processed in batches of `embedBatchSize`. This collapses N serial HTTP round-trips into N/batchSize batch requests.
- Falls back to per-blob `embed()` if `embedBatch` is unavailable or the batch call fails.
- **Recommended:** `--embed-batch-size 32` for local HTTP providers.

**Deliverables:** `src/core/indexing/indexer.ts`, `src/cli/commands/index.ts`, `src/cli/index.ts`.

**Version:** 0.50.0

---

### Phase 49 — Auto-VSS Default Path ✅ Implemented (v0.51.0)

**Goal:** Surface ANN search without requiring `--vss` explicitly.

- On `getActiveSession()` (or lazily on first search), check if `.gitsema/vss.index` exists. If so, load the usearch index and set a session-level flag.
- `vectorSearch()` checks the flag and routes through HNSW automatically.
- Print a one-time info line: `Using ANN index (build-vss to update).`
- Add `gitsema index --auto-build-vss` to rebuild the index after each indexing run when blob count exceeds a configurable threshold.
- **Version:** minor bump.

---

### Phase 50 — Real Multi-Repo Search ✅ Implemented (v0.52.0)

**Goal:** Deliver on the Phase 41 promise: query across multiple repos in one command.

- `gitsema repos search <query> [--repos id1,id2,...] [--top n]`
- Each registered repo must have a `db_path` column in the `repos` table.
- Open each DB with `openDatabaseAt(entry.db_path)`, run `vectorSearch()`, tag results with `repoId`, merge with `mergeSearchResults()`, re-rank.
- Expose as `POST /analysis/multi-repo-search` HTTP route and `multi_repo_search` MCP tool.
- **Version:** minor bump.

---

### Phase 51 — LSP Completion of the Protocol ✅ Implemented (v0.53.0)

**Goal:** Make `gitsema lsp` useful in real IDEs (VS Code, Neovim LSP, Helix).

- Implement `textDocument/definition` (find the blob that defines the symbol under cursor).
- Implement `workspace/symbol` (search all symbols by partial name).
- Return proper `MarkupContent` with Markdown hover cards.
- Add `--tcp <port>` option as an alternative to stdio.
- Expose a diagnostic: `gitsema doctor --lsp` to verify the LSP server starts correctly.
- **Version:** minor bump.

---

### Phase 52 — Query Expansion ✅ Implemented (v0.54.0)

**Goal:** Improve recall by expanding natural-language queries with repo-specific vocabulary before embedding.

- After embedding the raw query, extract the top BM25 keywords from FTS5 results.
- Split camelCase/snake_case identifiers in those keywords (`splitIdentifier` already exists in `labelEnhancer.ts`).
- Append the top-5 keywords to the query string and re-embed.
- Gate behind `--expand-query` flag initially; make default if F1 improves in integration tests.
- **Version:** minor bump.

---

### Phase 53 — Saved Searches and Watch Mode ✅ Implemented (v0.55.0)

**Goal:** Notify when new indexed content matches a saved query.

- New DB table: `saved_queries (id, name, query_text, query_embedding BLOB, last_run_ts, webhook_url)`.
- `gitsema watch add <name> <query> [--webhook url]` — stores the query.
- `gitsema watch run` — for each saved query, re-run with `after=last_run_ts`, print/POST new matches, update `last_run_ts`.
- Add `POST /watch/add` and `POST /watch/run` routes.
- **Version:** minor bump.

---

### Phase 54 — Index Bundle Export / Import ✅ Implemented (v0.56.0)

**Goal:** Share a pre-built index as a compressed artifact — useful for team settings where one machine builds the index and others query it.

- `gitsema export-index --out bundle.tar.gz` — archives `.gitsema/index.db` + `.gitsema/vss.index` (if present).
- `gitsema import-index --in bundle.tar.gz` — extracts to `.gitsema/`, validates schema version, runs any pending migrations.
- Checksums verify bundle integrity.
- **Version:** minor bump.

---

### Phase 55 — Embedding Space Explorer (Web UI) ✅ Implemented (v0.57.0)

**Goal:** Interactive 2D visualization of the embedding space.

- Compute UMAP/t-SNE projection on demand via a new `gitsema project` command (or reuse `gitsema map`). Store 2D coordinates in a `projections` table.
- `gitsema serve --ui` starts the HTTP server and also serves a single-page app from `src/client/` (React or plain HTML/JS).
- Features: pan/zoom, cluster coloring, hover → blob details, temporal slider animating by commit date, click → `gitsema show blob` in terminal.
- **Version:** minor bump.

---

### Phase 56 — LLM-Powered Evolution Narration ✅ Implemented (v0.58.0)

**Goal:** Convert the raw cosine-distance timelines from `gitsema evolution` into human-readable semantic summaries.

- After computing `computeEvolution()`, format the timeline diffs as a prompt and call a configured LLM endpoint (OpenAI-compatible, controlled by `GITSEMA_LLM_URL` / `GITSEMA_LLM_MODEL`).
- `gitsema evolution <path> --narrate` prints a paragraph summarizing the key semantic shifts.
- Fall back gracefully when no LLM is configured.
- **Version:** minor bump.

---

### Phase 57 — GitHub Actions Integration for CI Diff ✅ Implemented (v0.59.0)

**Goal:** Make `gitsema ci-diff` usable as a GitHub Actions step that posts a semantic diff comment on PRs.

- Ship an official `jsilvanus/gitsema-action@v1` GitHub Action in a companion repo (or subdirectory).
- The action: checks out the repo, runs `gitsema index --file` for changed files, runs `gitsema ci-diff --format html`, and posts the result as a PR review comment via the GitHub API.
- Add `--github-token` / `GITHUB_TOKEN` env var support to `ci-diff`.
- **Version:** minor bump.

---

### Phase 58 — Structured Security Scan (Static + Semantic) ✅ Implemented (v0.60.0)

**Goal:** Elevate `security-scan` from "semantic similarity" to a credible triage tool.

- Add per-language regex/AST heuristics (parameterized queries, input sanitisation helpers) as a first pass to reduce false positives.
- Use tree-sitter (already present as an optional dep in `functionChunker.ts`) to identify taint flows: user input → sink without sanitization.
- Only promote a match to a finding when both semantic similarity AND a structural signal agree.
- Integrate with SARIF output format for GitHub Code Scanning upload.
- **Version:** minor bump.

---

### Phase 59 — `gitsema tools` Subcommand Group (Protocol Servers) ✅ Implemented (v0.61.0)

**Goal:** Collect the long-running protocol-server commands (`mcp`, `lsp`, `serve`) into a single discoverable subcommand group so users have one clear entry-point for all tooling integration.

**Rationale:**
- `gitsema --help` currently intermixes one-shot analysis commands with persistent server processes that block the terminal. This makes it hard to discover server commands and understand that they are long-running.
- A `gitsema tools` group provides a natural home for any future tooling integrations (e.g. a gRPC server, a Language Server Protocol 3.18 implementation, a debug proxy, etc.).
- Backward-compatibility is preserved via hidden deprecated aliases at the top level.

**New command surface:**

| New preferred form | Description |
|---|---|
| `gitsema tools mcp` | Start the MCP stdio server (AI tool interface for Claude/Copilot) |
| `gitsema tools lsp` | Start the LSP JSON-RPC server (editor semantic hover / definition) |
| `gitsema tools lsp --tcp <port>` | Start LSP over TCP instead of stdio |
| `gitsema tools serve` | Start the HTTP embedding/storage API server |
| `gitsema tools serve --ui` | Include the embedding space explorer web UI |

**Deprecated aliases (kept for backward compatibility):**

| Old form | Status |
|---|---|
| `gitsema mcp` | Deprecated — prints deprecation notice, then delegates to `startMcpServer()` |
| `gitsema lsp` | Deprecated — prints deprecation notice, then delegates to `startLspServer()` |
| `gitsema serve` | Deprecated — prints deprecation notice, then delegates to `serveCommand()` |

**Implementation notes:**
- New file: `src/cli/commands/tools.ts` — exports `toolsCommand()` which registers `mcp`, `lsp`, and `serve` as Commander subcommands.
- `tools` is registered via `program.addCommand(toolsCommand())` in `src/cli/index.ts`.
- The `--help` command group map now has a new `Protocol Servers` group. `tools`, `serve`, `mcp`, and `lsp` are all assigned to it.
- The old top-level `serve` and `mcp` command actions print a `console.warn` deprecation notice before delegating. The `lsp` command (registered via `lspCommand()`) likewise.
- No schema changes, no version bump.

**Files changed:**
- `src/cli/commands/tools.ts` (new)
- `src/cli/commands/lsp.ts` — deprecation notice added to action
- `src/cli/index.ts` — import + `addCommand(toolsCommand())`, COMMAND_GROUPS updated, top-level `serve`/`mcp` actions updated

---

### Phase 60 — Uniform Column Headers + `--no-headings` Across All Commands ✅ Implemented (v.0.62.0)

**Goal:** Every command that produces tabular or structured output now prints a column header row by default, matching the existing `first-seen` pattern. All such commands also accept `--no-headings` to suppress the header row (useful for piping output to other tools).

**Rationale:**
- `first-seen` already had headers and `--no-headings`, but all other tabular commands did not. This made output inconsistent and harder to read at a glance.
- Column headers communicate what each field means without requiring the user to consult docs.
- `--no-headings` preserves machine-readable output for scripts and pipelines.

**Commands updated:**

| Command | Header columns added |
|---|---|
| `search` / `code-search` | Score, Path, [Blob] |
| `file-evolution` | Date, Blob, Commit, Dist_Prev, Dist_Origin |
| `evolution` / `concept-evolution` | Date, Path, [Blob], Score, Dist_Prev |
| `debt` | Blob, Score, Path |
| `security-scan` | Pattern, Confidence, Score, Blob, Path |
| `health` | Period_Start, Period_End, Active, Churn, Dead |
| `heatmap` | Period, Count |
| `repos list` | ID, Name, URL, DB_Path, Added |
| `repos search` | Repo, Score, Path |
| `dead-concepts` | Section title (suppressed by `--no-headings`) |
| `change-points` | Report title (suppressed by `--no-headings`) |
| `file-change-points` | Report title (suppressed by `--no-headings`) |
| `refactor-candidates` | Report header (suppressed by `--no-headings`) |
| `clusters` | Summary line (suppressed by `--no-headings`) |
| `author` | Query title (suppressed by `--no-headings`) |
| `impact` | Target header (suppressed by `--no-headings`) |

**Naming convention:** Consistent with `first-seen`:
- Commander.js option: `--no-headings`
- TypeScript property: `noHeadings?: boolean`
- Passed to renderer as: `!options.noHeadings`

**Implementation notes:**
- `renderResults()` in `src/core/search/ranking.ts` gained a `showHeadings = true` parameter. The existing `renderFirstSeenResults()` already had this.
- `renderEvolution()` in `src/cli/commands/evolution.ts` gained a `showHeadings` parameter.
- `renderConceptEvolution()` in `src/cli/commands/conceptEvolution.ts` gained a `showHeadings` parameter (function refactored from `.map().join()` to a `for` loop to support header insertion).
- `renderReport()` in `impact.ts` and `refactorCandidates.ts` gained a `showHeadings` parameter.
- All structured commands (`dead-concepts`, `clusters`, `author`, `change-points`, `file-change-points`) suppress their top-level title line when `--no-headings` is set.
- No schema changes. No database migrations.

**Files changed:**
- `src/core/search/ranking.ts` — `renderResults()` gains `showHeadings` param
- `src/cli/commands/search.ts` — `noHeadings` option
- `src/cli/commands/codeSearch.ts` — `noHeadings` option + `--no-headings` flag
- `src/cli/commands/evolution.ts` — `noHeadings` option, `renderEvolution()` gains header
- `src/cli/commands/conceptEvolution.ts` — `noHeadings` option, `renderConceptEvolution()` gains header
- `src/cli/commands/debt.ts` — `noHeadings` option + header row
- `src/cli/commands/securityScan.ts` — `noHeadings` option + header row
- `src/cli/commands/health.ts` — `noHeadings` option + header row
- `src/cli/commands/heatmap.ts` — `noHeadings` option + header row
- `src/cli/commands/repos.ts` — `noHeadings` for `list` and `search` subcommands + header rows
- `src/cli/commands/deadConcepts.ts` — `noHeadings` to suppress section title
- `src/cli/commands/changePoints.ts` — `noHeadings` to suppress report title
- `src/cli/commands/fileChangePoints.ts` — `noHeadings` to suppress report title
- `src/cli/commands/refactorCandidates.ts` — `renderReport()` gains `showHeadings` param
- `src/cli/commands/clusters.ts` — `noHeadings` to suppress summary line
- `src/cli/commands/author.ts` — `noHeadings` to suppress query title
- `src/cli/commands/impact.ts` — `renderReport()` gains `showHeadings` param
- `src/cli/index.ts` — `--no-headings` added to registrations for `search`, `file-evolution`, `evolution`, `heatmap`, `dead-concepts`, `impact`, `clusters`, `refactor-candidates`, `change-points`, `file-change-points`, `author`

---

### Phase 61 — MCP/HTTP Parity + Semantic PR Report *(completed v0.64.0)*

**Goal:** Productize current analysis primitives into a single CI/review workflow and close cross-surface parity gaps.

**Implemented scope:**

- Added `experts` parity outside CLI:
  - MCP tool: `experts`
  - HTTP route: `POST /api/v1/analysis/experts`
- Added `gitsema pr-report` command composing:
  - semantic diff summary
  - impacted modules
  - change-point highlights
  - reviewer suggestions (`experts`)
- Machine-readable output (`--dump`) for CI/bot ingestion.

**Status:** ✅ complete.

---

### Phase 62 — Heavy Batching for Ollama + HTTP Providers *(completed v0.67.0)*

**Goal:** Improve indexing throughput by adding robust batch embedding support optimised for both Ollama and OpenAI-compatible HTTP providers.

**Implemented scope:**

- **`BatchingProvider`** wrapper (`src/core/embedding/batching.ts`): wraps any `EmbeddingProvider` and adds transparent sub-batch chunking (configurable `maxSubBatchSize`, default 32), per-sub-batch retry with exponential back-off (`retries`, `retryDelayMs`), and automatic per-item fallback (zero-vector on total failure so indexing continues).
- **OllamaProvider true-batch** (`src/core/embedding/local.ts`): `embedBatch()` now uses Ollama's `/api/embed` endpoint (available since Ollama 0.1.34) which accepts `input: string[]` natively — eliminating N round-trips for a batch. Gracefully falls back to concurrent per-item `/api/embeddings` calls when the server returns 404, and remembers the unavailability so no further probing occurs.
- **`buildBatchingProvider()`** factory (`src/core/embedding/providerFactory.ts`): convenience function that constructs any provider and wraps it in `BatchingProvider` in one call.

**Status:** ✅ complete.

---

### Phase 63 — Indexing Auto-Defaults and Adaptive Tuning *(completed v0.65.0)*

**Goal:** Make indexing fast by default without requiring deep manual tuning.

**Implemented scope:**

- Auto-enabled batch mode when provider supports `embedBatch()` (via `resolveEmbedBatchSize` in `adaptiveTuning.ts`).
- `AdaptiveBatchController` class for in-flight batch size adjustment based on observed latency and error rate.
- Profile presets (`--profile speed|balanced|quality`) on `gitsema index` for coherent concurrency/batch/chunker defaults.
- Post-run maintenance recommendations (`postRunRecommendations`) for VSS/FTS/vacuum.
- `IndexerOptions.profileBatchSize` field for profile-driven auto-batch.

**Status:** ✅ complete.

---

### Phase 64 — Search Scalability + AI Retrieval Reliability *(completed v0.66.0)*

**Goal:** Reduce broad-query cost and improve trust for AI-assisted coding workflows.

**Implemented scope:**
- Top-k early-cut scoring mode (`--early-cut <n>` on `gitsema search`, `earlyCut` in `VectorSearchOptions`) to avoid full candidate materialisation on very large pools.
- Capabilities manifest endpoint (`GET /api/v1/capabilities`) for CLI/MCP/HTTP integration clients.
- Provenance-oriented explain output optimised for LLM prompts (`--explain-llm` on `gitsema search`, `formatExplainForLlm` in `explainFormatter.ts`).
- Retrieval evaluation harness (`gitsema eval <file>`) measuring P@k, R@k, MRR, and latency from a JSONL eval file.

**Status:** ✅ complete.

---

### Phase 65 — Incident Triage Bundle *(completed v0.68.0)*

Goal: Provide a one-command incident triage workflow that composes first-seen, change-points, file-evolution alerts, bisect, and experts into a single guided report. CLI: `gitsema triage <query> [--ref1 <ref>] [--ref2 <ref>] [--file <path>] [--top <n>] [--dump <file>]`.

**Implemented:** `src/cli/commands/triage.ts`. Gracefully handles per-section failures.

---

### Phase 66 — Policy Checks for CI *(completed v0.68.0)*

Goal: Threshold-based CI gates for drift, debt score, and security similarity. CLI: `gitsema policy check [--max-drift <n>] [--max-debt-score <n>] [--min-security-score <n>] --query <text> [--dump <file>]`.

**Implemented:** `src/cli/commands/policyCheck.ts`. Exits with code 1 when any gate fails.

---

### Phase 67 — Ownership Heatmap by Concept *(completed v0.68.0)*

Goal: Compute ownership confidence and temporal trends for a semantic concept. Introduces `computeOwnershipHeatmap()` and CLI `gitsema ownership <query> [--top <n>] [--window <days>] [--dump <file>]`.

**Implemented:** `src/core/search/ownershipHeatmap.ts`, `src/cli/commands/ownership.ts`.

---

### Phase 68 — Persistent Workflow Templates *(completed v0.68.0)*

Goal: Config-driven workflow templates that chain existing commands (pr-review, incident, release-audit) and emit markdown or JSON reports. CLI: `gitsema workflow run <template> [--format markdown|json] [--dump <file>]`.

**Implemented:** `src/cli/commands/workflow.ts`. Templates call core functions in-process.

---

### Phase 69 — Pipelined Batch Indexing *(completed v0.68.0)*

Goal: Overlap read/embed/store stages in the indexer via a simple AsyncQueue so embed and store stages can work concurrently on successive batches. Adds `src/utils/asyncQueue.ts` and changes the batch-path in `src/core/indexing/indexer.ts` when `useBatchPath === true`.

**Implemented:** `src/utils/asyncQueue.ts`, modified `src/core/indexing/indexer.ts` batch path.

---

### Phase 70 — Unified Output System *(completed v0.69.0)*

Goal: Replace the scattered `--dump`, `--html`, `--format` flags with a single composable `--out <spec>` flag that can be repeated to produce multiple outputs simultaneously. Headers, verbose content, and machine-readable formats all flow through the same abstraction.

**Design:**
- `--out <format>[:<file>]` — format is one of `text | json | html | markdown | sarif`; if `:file` is omitted, output goes to stdout
- Repeatable: `--out json:results.json --out html:report.html` produces both outputs in one run
- `src/utils/outputSink.ts` — `parseOutputSpec()`, `resolveOutputs()`, `writeToSink()`, `hasSinkFormat()`, `getSink()` helpers
- `resolveOutputs()` bridges from the legacy `--dump` / `--html` / `--format` flags transparently so existing scripts keep working
- Wired into: `search`, `evolution`, `triage`, `policy check`, `ownership`, `workflow run`

**Backward compatibility:** `--dump` / `--html` / `--format` kept as deprecated aliases on all modified commands; they are auto-translated to the equivalent `--out` spec internally.

**Implemented:** `src/utils/outputSink.ts`, updated `search.ts`, `conceptEvolution.ts`, `triage.ts`, `policyCheck.ts`, `ownership.ts`, `workflow.ts`, `cli/index.ts`. 20 new tests in `tests/outputSink.test.ts`.

---

### Phase 71 — Index Status Dashboard + Model Management *(completed v0.71.0)*

Goal: Make `gitsema index` a read-only coverage dashboard, add explicit `gitsema index start`, consolidate all DB/index maintenance commands as subcommands of `gitsema index`, and add `gitsema models` for per-model provider management.

**Implemented scope:**

- `gitsema index` — read-only coverage report (Git-reachable blobs vs. indexed blobs per model)
- `gitsema index start [options]` — explicit indexing entry point (all former `gitsema index` flags moved here)
- All maintenance commands consolidated under `gitsema index`:
  `doctor`, `vacuum`, `rebuild-fts`, `backfill-fts`, `gc`, `clear-model`, `update-modules`, `build-vss`
- Old top-level forms kept as hidden deprecated aliases with migration hints
- `gitsema models` command group (`list`, `info`, `add`, `remove`) for per-model provider configuration
- Per-model provider profiles stored under `models.<name>` in config files; override global `GITSEMA_PROVIDER` / `GITSEMA_HTTP_URL` / `GITSEMA_API_KEY`
- `buildProviderForModel()` in `providerFactory.ts` — resolves per-model config before falling back to env vars
- `getTextProvider()` and `getCodeProvider()` updated to look up per-model profile for the resolved model name
- Schema **v18**: `last_used_at INTEGER` on `embed_config`, updated by `saveEmbedConfig()` on each indexing run
- `--level <level>` alias on `gitsema index start`: `blob`/`file` → `--chunker file`, `function` → `--chunker function`, `fixed` → `--chunker fixed`

**Status:** ✅ complete.

---

### Planned Phases (72+)

The following phases are derived from the **review5** strategic review (reflecting repository state at v0.70.0). Items already shipped are noted inline.

---

### Phase 71 — Operational Readiness: Metrics, Rate Limiting, and OpenAPI *(completed v0.71.0)*

**Goal:** Give shared-server deployments the observability and access-control primitives needed to run gitsema as a reliable service.

**Implemented scope:**
- `GET /metrics` Prometheus endpoint via `prom-client` — query latency histograms, index size gauge, provider error counter, cache hit ratio (`src/server/middleware/metrics.ts`, `src/utils/metricsCounters.ts`).
- Rate limiting via `express-rate-limit` with per-token (or per-IP for unauthenticated) caps; `Retry-After` header on 429 responses (`src/server/middleware/rateLimiter.ts`).
- OpenAPI spec auto-generated from Zod schemas via `zod-to-openapi`; served at `GET /openapi.json` and `GET /docs` (`src/server/routes/openapi.ts`).

**Status:** ✅ complete.

---

### Phase 72 — HTTP Route Parity for All Analysis Commands *(completed v0.72.0)*

**Goal:** Close the HTTP API gap identified in review5 — Phase 41–47 and Phase 65–70 commands (all in CLI and many in MCP) lacked HTTP routes.

**Implemented scope:**
- `POST /api/v1/analysis/security-scan`, `/health`, `/debt`, `/doc-gap`, `/contributor-profile`, `/triage`, `/policy-check`, `/ownership`, `/workflow`, `/eval` added to `src/server/routes/analysis.ts`.
- Each route validates the request body with a Zod schema and delegates to the same core function as the CLI command.

**Status:** ✅ complete.

---

### Phase 73 — Deployment Guide and Docker Infrastructure

**Goal:** Eliminate the primary adoption barrier for teams that want to self-host gitsema as a shared service.

**Scope:**
- `Dockerfile` — multi-stage build: compile TypeScript, copy `dist/` + `package.json`, default CMD = `node dist/cli/index.js tools serve`.
- `docker-compose.yml` — gitsema HTTP server + Ollama sidecar with persistent volume for `.gitsema/`.
- `docs/deploy.md` — cover systemd unit, Docker Compose, API key rotation, index backup strategy, embedding model upgrade path, and SQLite-vs-VSS guidance.

**Status:** `docs/deploy.md` written. `Dockerfile` and `docker-compose.yml` not yet added.

---

### Phase 74 — `gitsema status` Scale Warnings + Extended `gitsema doctor` Pre-flight

**Goal:** Make the tool self-explaining about scale limits so users don't hit OOM or slow queries without warning.

**Scope:**
- `gitsema status`: when blob count exceeds a configurable threshold (default 50 000), print a prominent warning recommending `gitsema build-vss` and/or `--early-cut`. Show whether a VSS index exists and is up-to-date.
- `gitsema doctor --extended` (or make the checks default):
  - Verify embedding model is reachable (attempt a one-token embed call to the configured provider).
  - Check index freshness: compare `max(commit_ts)` in `indexed_commits` against `git log -1 --format=%ct HEAD`; warn if more than N commits behind.
  - Estimate search latency class: `fast` (< 10K blobs or VSS present), `moderate` (10K–50K, no VSS), `slow` (> 50K, no VSS, no early-cut).
  - Warn when `CURRENT_SCHEMA_VERSION` > the version recorded in the `meta` table.
- First-slow-query hint: after any search that exceeds a configurable wall-clock threshold (default 5 s), print a one-time suggestion to run `gitsema build-vss`.

**Status:** ⬜ not yet started.

---

### Phase 75 — Per-Repo Access Control on HTTP Server

**Goal:** When multiple repos are registered, allow scoping a `GITSEMA_SERVE_KEY` token to a specific repo ID so different users only see their own repo's results.

**Scope:**
- Introduce a `repo_tokens` table (or extend `repos`) mapping token → repo ID.
- Auth middleware reads the token, looks up the allowed repo ID, and injects it as `req.repoId`.
- All search/analysis routes filter their DB queries by `repoId` when set.
- `gitsema repos token add <repo-id>` CLI to mint scoped tokens.
- Document in `docs/deploy.md`.

**Status:** ⬜ not yet started.

---

### Phase 76 — Complete `htmlRenderer.ts` Modularisation

**Goal:** The main `htmlRenderer.ts` is still ~1 400 LOC after the partial split in Phase 70. Finish the modularisation so each visualisation type lives in its own file, is independently unit-testable, and can be tree-shaken.

**Scope:**
- Extract remaining renderers from `htmlRenderer.ts` into focused modules: `htmlRenderer-evolution.ts`, `htmlRenderer-clusters.ts`, `htmlRenderer-map.ts`.
- Document the CSS/JS baseline (shared constants in `htmlRenderer-shared.ts`) so contributors can add new visualisations without touching unrelated code.
- Add per-module unit tests verifying render output structure (not pixel accuracy).

**Status:** ⬜ not yet started.

---

### Phase 77 — Unified Indexing + Search Level Concept

**Background:** Indexing granularity (blob/function/fixed) and search granularity (file/chunk/symbol/module) are currently controlled by separate flags on separate commands (`--chunker` on `index start`, `--level` on `search`). Phase 71 adds a `--level` alias to `index start` to bridge the gap, but the underlying abstractions remain distinct.

**Goal:** Unify the "level" concept so that:
1. A configured level (`blob` / `function` / `fixed`) is remembered in `embed_config` and auto-applied to subsequent searches.
2. `gitsema search --level function` automatically restricts results to the chunk/symbol tables (no need for separate `--chunks` / `--symbols` flags).
3. `gitsema index start --level function` stores both whole-file and function-level embeddings in one run (today it's either/or).
4. A `models add <name> --level function` sets the default indexing granularity for a model.

**Complexity:** Medium. Requires schema changes, config propagation, and backwards-compatible search query routing.

**Status:** ⬜ not yet started.

---

### Long-Term Investments (Phase 77+)

| Feature | Complexity | Notes |
|---------|:----------:|-------|
| DuckDB / pgvector migration path | High | For corpora >500K blobs; keep SQLite as default |
| Cross-repo concept similarity | High | Index two repos; find when concept X first appeared in each |
| Semantic regression CI gate | High | Flag PRs where key embedding drifts beyond threshold |
| Plugin API for custom analysers | High | Allow third-party modules to register their own search/analysis commands |
| Python model server (Phase 13 revival) | Medium | sentence-transformers in Docker; higher throughput than Ollama for bulk indexing |
| Semantic code review assistant | Medium | Given a PR diff, find historical analogues and flag regressions |
| `gitsema repl` interactive query loop | Low | Improve exploratory use without requiring repeated CLI invocations |
| `gitsema quickstart` guided wizard | Low | Reduce zero-to-result friction for new users |

**Scale notes (from review5):**

- **Search memory:** candidate materialisation is proportional to index size. The ANN search path (auto-enabled above `GITSEMA_VSS_THRESHOLD`) caps query time; use `gitsema build-vss` on large repos.
- **Indexing time:** pipelined batching (Phase 69) overlaps read/embed/store stages, but commit-mapping still runs serially after all batches. For repos with deep history, this phase can dominate wall-clock time on incremental runs.
- **Chunk/symbol candidate expansion:** when `--chunks` or `--vss` is combined with a large index the candidate pool grows 3–10× before scoring. Monitor RSS when indexing large monorepos with `--chunker function`.
