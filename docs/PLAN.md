# gitsema — Refined Development Plan

> A Git-aware semantic search engine that treats code history as a time-indexed semantic dataset.

---

## Table of Contents

| Section | Line |
|---|---:|
| [Vision](#vision) | 107 |
| [Guiding principles](#guiding-principles) | 113 |
| [Architecture overview](#architecture-overview) | 123 |
| [Project structure](#project-structure) | 143 |
| [Section I - Phases](#section-i-phases) | 195 |
|   [Phase 1 — Foundation](#phase-1-—-foundation) | 197 |
|   [Phase 2 — Git walking](#phase-2-—-git-walking) | 239 |
|   [Phase 3 — Embedding system](#phase-3-—-embedding-system) | 263 |
|   [Phase 4 — Indexing](#phase-4-—-indexing) | 301 |
|   [Phase 5 — Search  ·  *MVP deliverable*](#phase-5-—-search-·-mvp-deliverable) | 327 |
|   [Phase 6 — Commit mapping](#phase-6-—-commit-mapping) | 360 |
|   [Phase 7 — Time-aware queries  ·  *Phase 2 deliverable*](#phase-7-—-time-aware-queries-·-phase-2-deliverable) | 397 |
|   [Phase 8 — File-type-aware embedding models](#phase-8-—-file-type-aware-embedding-models) | 430 |
|   [Phase 9 — Performance](#phase-9-—-performance) | 468 |
|   [Phase 10 — Smarter semantics](#phase-10-—-smarter-semantics) | 506 |
|   [Phase 11 — Advanced features + MCP](#phase-11-—-advanced-features-mcp) | 551 |
|   [Phase 11b — Content access and semantic concept tracking](#phase-11b-—-content-access-and-semantic-concept-tracking) | 622 |
| [Key technical decisions](#key-technical-decisions) | 739 |
| [Risk register](#risk-register) | 751 |
|   [Phase 12 — CLI consolidation & robust per-file indexing](#phase-12-—-cli-consolidation-robust-per-file-indexing) | 763 |
|   [Recent progress (snapshot: 2026-04-01)](#recent-progress-snapshot-2026-04-01) | 793 |
|   [Phase 13 — Standalone model server for embeddings](#phase-13-—-standalone-model-server-for-embeddings) | 809 |
|   [Phase 14 — Infrastructure, tooling, and maintenance](#phase-14-—-infrastructure-tooling-and-maintenance) | 892 |
|   [Phase 14b — Search result deduplication](#phase-14b-—-search-result-deduplication) | 949 |
|   [Phase 15 — Branch awareness](#phase-15-—-branch-awareness) | 983 |
|   [Phase 16 — Remote-repository indexing (server-managed clone, RAM-backed working tree, persistent DB)](#phase-16-—-remote-repository-indexing-server-managed-clone-ram-backed-working-tree-persistent-db) | 1055 |
|   [Phase 17 — Remote-indexing hardening and SSH support](#phase-17-—-remote-indexing-hardening-and-ssh-support) | 1313 |
|   [Phase 18 — Reliability, tests, and query caching](#phase-18-—-reliability-tests-and-query-caching) | 1384 |
|   [Phase 19 — Smarter chunking, semantic blame & symbol-level embeddings](#phase-19-—-smarter-chunking-semantic-blame-symbol-level-embeddings) | 1398 |
|   [Phase 20 — Dead-concept detection & refactor impact analysis](#phase-20-—-dead-concept-detection-refactor-impact-analysis) | 1463 |
|   [Phase 21 — Semantic clustering & concept graph](#phase-21-—-semantic-clustering-concept-graph) | 1476 |
|   [Phase 22 — Temporal cluster diff](#phase-22-—-temporal-cluster-diff) | 1489 |
|   [Phase 23 — Cluster timeline](#phase-23-—-cluster-timeline) | 1502 |
|   [Phase 24 — Enhanced cluster labeling](#phase-24-—-enhanced-cluster-labeling) | 1516 |
|   [Phase 25 — Interactive HTML visualizations](#phase-25-—-interactive-html-visualizations) | 1530 |
|   [Phase 26 — CLI naming consolidation & conceptual diff](#phase-26-—-cli-naming-consolidation-conceptual-diff) | 1545 |
|   [Phase 27 — Semantic change-point detection](#phase-27-—-semantic-change-point-detection) | 1586 |
|   [Phase 28 — Persistent configuration management](#phase-28-—-persistent-configuration-management) | 1646 |
|   [Phase 29 — Automated indexing via Git hooks](#phase-29-—-automated-indexing-via-git-hooks) | 1673 |
|   [Phase 30 — Commit message semantic indexing](#phase-30-—-commit-message-semantic-indexing) | 1689 |
|   [Phase 31 — Semantic concept authorship ranking](#phase-31-—-semantic-concept-authorship-ranking) | 1740 |
|   [Phase 32 — Branch and merge awareness](#phase-32-—-branch-and-merge-awareness) | 1790 |
|   [Phase 33 — Multi-level hierarchical indexing](#phase-33-—-multi-level-hierarchical-indexing) | 1851 |
|   [Phase 34 — Feature adoption & cross-cutting improvements](#phase-34-—-feature-adoption-cross-cutting-improvements) | 1907 |
|   [Phase 35 — Multi-model DB, per-command model flags, clear-model, multi-model search](#phase-35-—-multi-model-db-per-command-model-flags-clear-model-multi-model-search) | 1945 |
|   [Phase 36 — Vector Index (VSS), Int8 Quantization, ANN Search](#phase-36-—-vector-index-vss-int8-quantization-ann-search) | 1983 |
|   [Phase 37 — Quick Wins: Selective Indexing, Code-to-Code Search, Negative Examples, Result Explanation](#phase-37-—-quick-wins-selective-indexing-code-to-code-search-negative-examples-result-explanation) | 2057 |
|   [Phase 38 — Medium Effort: Documentation Gap Analysis, Semantic Bisect, GC, Boolean Queries](#phase-38-—-medium-effort-documentation-gap-analysis-semantic-bisect-gc-boolean-queries) | 2082 |
|   [Phase 39 — Analysis Features: Contributor Profiles, Refactoring, Lifecycle, CI Diff](#phase-39-—-analysis-features-contributor-profiles-refactoring-lifecycle-ci-diff) | 2107 |
|   [Phase 40 — Visualization & Scale: Codebase Map, Temporal Heatmap, Remote Index, Cherry-Pick](#phase-40-—-visualization-scale-codebase-map-temporal-heatmap-remote-index-cherry-pick) | 2132 |
|   [Phase 41 — Multi-Repo Unified Index *(completed v0.43.0)*](#phase-41-—-multi-repo-unified-index-completed-v0430) | 2163 |
|   [Phase 42 — IDE / LSP Integration *(completed v0.44.0)*](#phase-42-—-ide-lsp-integration-completed-v0440) | 2179 |
|   [Phase 43 — Security Pattern Detection *(completed v0.45.0)*](#phase-43-—-security-pattern-detection-completed-v0450) | 2195 |
|   [Phase 44 — Codebase Health Timeline *(completed v0.46.0)*](#phase-44-—-codebase-health-timeline-completed-v0460) | 2210 |
|   [Phase 45 — Technical Debt Scoring *(completed v0.47.0)*](#phase-45-—-technical-debt-scoring-completed-v0470) | 2225 |
|   [Phase 46 — Evolution Alerts and Commit URL Construction *(completed v0.48.0)*](#phase-46-—-evolution-alerts-and-commit-url-construction-completed-v0480) | 2242 |
|   [Phase 47 — Richer Indexing Progress, Embed Latency Stats, and Incremental-by-Default Messaging](#phase-47-—-richer-indexing-progress-embed-latency-stats-and-incremental-by-default-messaging) | 2257 |
|   [Phase 48 — Batch Embedding and Provider Throughput ✅ Implemented](#phase-48-—-batch-embedding-and-provider-throughput-✅-implemented) | 2287 |
|   [Phase 49 — Auto-VSS Default Path ✅ Implemented (v0.51.0)](#phase-49-—-auto-vss-default-path-✅-implemented-v0510) | 2302 |
|   [Phase 50 — Real Multi-Repo Search ✅ Implemented (v0.52.0)](#phase-50-—-real-multi-repo-search-✅-implemented-v0520) | 2314 |
|   [Phase 51 — LSP Completion of the Protocol ✅ Implemented (v0.53.0)](#phase-51-—-lsp-completion-of-the-protocol-✅-implemented-v0530) | 2326 |
|   [Phase 52 — Query Expansion ✅ Implemented (v0.54.0)](#phase-52-—-query-expansion-✅-implemented-v0540) | 2339 |
|   [Phase 53 — Saved Searches and Watch Mode ✅ Implemented (v0.55.0)](#phase-53-—-saved-searches-and-watch-mode-✅-implemented-v0550) | 2351 |
|   [Phase 54 — Index Bundle Export / Import ✅ Implemented (v0.56.0)](#phase-54-—-index-bundle-export-import-✅-implemented-v0560) | 2363 |
|   [Phase 55 — Embedding Space Explorer (Web UI) ✅ Implemented (v0.57.0)](#phase-55-—-embedding-space-explorer-web-ui-✅-implemented-v0570) | 2374 |
|   [Phase 56 — LLM-Powered Evolution Narration ✅ Implemented (v0.58.0)](#phase-56-—-llm-powered-evolution-narration-✅-implemented-v0580) | 2385 |
|   [Phase 57 — GitHub Actions Integration for CI Diff ✅ Implemented (v0.59.0)](#phase-57-—-github-actions-integration-for-ci-diff-✅-implemented-v0590) | 2396 |
|   [Phase 58 — Structured Security Scan (Static + Semantic) ✅ Implemented (v0.60.0)](#phase-58-—-structured-security-scan-static-semantic-✅-implemented-v0600) | 2407 |
|   [Phase 59 — `gitsema tools` Subcommand Group (Protocol Servers) ✅ Implemented (v0.61.0)](#phase-59-—-gitsema-tools-subcommand-group-protocol-servers-✅-implemented-v0610) | 2419 |
|   [Phase 60 — Uniform Column Headers + `--no-headings` Across All Commands ✅ Implemented (v.0.62.0)](#phase-60-—-uniform-column-headers-no-headings-across-all-commands-✅-implemented-v0620) | 2460 |
|   [Phase 61 — MCP/HTTP Parity + Semantic PR Report *(completed v0.64.0)*](#phase-61-—-mcphttp-parity-semantic-pr-report-completed-v0640) | 2525 |
|   [Phase 62 — Heavy Batching for Ollama + HTTP Providers *(completed v0.67.0)*](#phase-62-—-heavy-batching-for-ollama-http-providers-completed-v0670) | 2545 |
|   [Phase 63 — Indexing Auto-Defaults and Adaptive Tuning *(completed v0.65.0)*](#phase-63-—-indexing-auto-defaults-and-adaptive-tuning-completed-v0650) | 2559 |
|   [Phase 64 — Search Scalability + AI Retrieval Reliability *(completed v0.66.0)*](#phase-64-—-search-scalability-ai-retrieval-reliability-completed-v0660) | 2575 |
|   [Phase 65 — Incident Triage Bundle *(completed v0.68.0)*](#phase-65-—-incident-triage-bundle-completed-v0680) | 2589 |
|   [Phase 66 — Policy Checks for CI *(completed v0.68.0)*](#phase-66-—-policy-checks-for-ci-completed-v0680) | 2597 |
|   [Phase 67 — Ownership Heatmap by Concept *(completed v0.68.0)*](#phase-67-—-ownership-heatmap-by-concept-completed-v0680) | 2605 |
|   [Phase 68 — Persistent Workflow Templates *(completed v0.68.0)*](#phase-68-—-persistent-workflow-templates-completed-v0680) | 2613 |
|   [Phase 69 — Pipelined Batch Indexing *(completed v0.68.0)*](#phase-69-—-pipelined-batch-indexing-completed-v0680) | 2621 |
|   [Phase 70 — Unified Output System *(completed v0.69.0)*](#phase-70-—-unified-output-system-completed-v0690) | 2629 |
|   [Phase 71 — Index Status Dashboard + Model Management *(completed v0.71.0)*](#phase-71-—-index-status-dashboard-model-management-completed-v0710) | 2646 |
|   [Planned Phases (72+)](#planned-phases-72) | 2668 |
|   [Phase 71 — Operational Readiness: Metrics, Rate Limiting, and OpenAPI *(completed v0.71.0)*](#phase-71-—-operational-readiness-metrics-rate-limiting-and-openapi-completed-v0710) | 2674 |
|   [Phase 72 — HTTP Route Parity for All Analysis Commands *(completed v0.72.0)*](#phase-72-—-http-route-parity-for-all-analysis-commands-completed-v0720) | 2687 |
|   [Phase 73 — Deployment Guide and Docker Infrastructure](#phase-73-—-deployment-guide-and-docker-infrastructure) | 2699 |
|   [Phase 74 — `gitsema status` Scale Warnings + Extended `gitsema doctor` Pre-flight](#phase-74-—-gitsema-status-scale-warnings-extended-gitsema-doctor-pre-flight) | 2712 |
|   [Phase 75 — Per-Repo Access Control on HTTP Server](#phase-75-—-per-repo-access-control-on-http-server) | 2725 |
|   [Phase 76 — Complete `htmlRenderer.ts` Modularisation](#phase-76-—-complete-htmlrendererts-modularisation) | 2739 |
|   [Phase 77 — Unified Indexing + Search Level Concept](#phase-77-—-unified-indexing-search-level-concept) | 2752 |
|   [Phase 82 — Auto-cap Search Memory *(completed v0.79.0)*](#phase-82-—-auto-cap-search-memory-completed-v0790) | 2768 |
|   [Phase 83 — Parallel Commit-Message Embedding *(completed v0.80.0)*](#phase-83-—-parallel-commit-message-embedding-completed-v0800) | 2780 |
|   [Phase 84 — LSP: documentSymbol + Improved definition/references *(completed v0.81.0)*](#phase-84-—-lsp-documentsymbol-improved-definitionreferences-completed-v0810) | 2794 |
|   [Phase 85 — Tier-1 Reliability: Test Isolation, SQL Sampling, Batch Dedup *(completed v0.84.0)*](#phase-85-—-tier-1-reliability-test-isolation-sql-sampling-batch-dedup-completed-v0840) | 2808 |
|   [Phase 86 — Tier-2 Code Organisation: MCP Modularization + Search Module Split + CLI Register Split *(completed v0.85.0)*](#phase-86-—-tier-2-code-organisation-mcp-modularization-search-module-split-cli-register-split-completed-v0850) | 2836 |
|   [Phase 87 — Tier-3 Robustness: Embed Retry, Queue Backpressure, Atomic FTS5, Body Limit *(completed v0.86.0)*](#phase-87-—-tier-3-robustness-embed-retry-queue-backpressure-atomic-fts5-body-limit-completed-v0860) | 2864 |
|   [Phase 88 — Tier-4 Scale/Features: LLM Narrator Tests + Docs Sync Check *(completed v0.87.0)*](#phase-88-—-tier-4-scalefeatures-llm-narrator-tests-docs-sync-check-completed-v0870) | 2896 |
|   [Phase 89 — Tier-5 Code Quality: review6 §11 Detailed Findings *(completed v0.88.0)*](#phase-89-—-tier-5-code-quality-review6-§11-detailed-findings-completed-v0880) | 2920 |
|   [Phase 90 — Model Local Names (Shorthand / globalName) *(completed v0.89.0)*](#phase-90-—-model-local-names-shorthand-globalname-completed-v0890) | 3000 |
|   [Phase 91 — 8 Productized Usage Patterns (review7 §5) *(completed v0.90.0)*](#phase-91-—-8-productized-usage-patterns-review7-§5-completed-v0900) | 3055 |
|   [Phase 92 — review7 Improvement Bundle *(completed, 2026-04-09)*](#phase-92-—-review7-improvement-bundle-completed-2026-04-09) | 3101 |
|   [Phase 93 — Time filter semantics & pagination stability](#phase-93-—-time-filter-semantics-pagination-stability) | 3143 |
| [Long-Term Investments](#long-term-investments) | 3173 |
| [Non-goals for now (revisited later)](#non-goals-for-now-revisited-later) | 3186 |

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

**Status:** ✅ complete (`docs/deploy.md`, `Dockerfile`, `docker-compose.yml` all shipped).

---

### Phase 74 — `gitsema status` Scale Warnings + Extended `gitsema doctor` Pre-flight

**Goal:** Make the tool self-explaining about scale limits so users don't hit OOM or slow queries without warning.

**Implemented scope:**
- `gitsema status`: prints scale warning when blob count exceeds threshold; shows VSS index presence and staleness.
- `gitsema doctor --extended`: verifies provider reachability, checks index freshness vs HEAD, estimates latency class (`fast`/`moderate`/`slow`), warns on schema version mismatch.
- First-slow-query hint wired into search path.

**Status:** ✅ complete.

---

### Phase 75 — Per-Repo Access Control on HTTP Server

**Goal:** When multiple repos are registered, allow scoping a `GITSEMA_SERVE_KEY` token to a specific repo ID so different users only see their own repo's results.

**Implemented scope:**
- `repo_tokens` table mapping token → repo ID.
- Auth middleware resolves token to `repoId`; all search/analysis routes filter by it.
- `gitsema repos token add <repo-id>` CLI to mint scoped tokens.
- Documented in `docs/deploy.md`.

**Status:** ✅ complete.

---

### Phase 76 — Complete `htmlRenderer.ts` Modularisation

**Goal:** The main `htmlRenderer.ts` is still ~1 400 LOC after the partial split in Phase 70. Finish the modularisation so each visualisation type lives in its own file, is independently unit-testable, and can be tree-shaken.

**Implemented scope:**
- `htmlRenderer-evolution.ts`, `htmlRenderer-clusters.ts`, `htmlRenderer-map.ts` extracted from the monolith.
- `htmlRenderer-shared.ts` holds the CSS/JS baseline shared across all renderers.
- `htmlRenderer.ts` now re-exports the split modules and is ~100 LOC of glue.

**Status:** ✅ complete.

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

### Phase 82 — Auto-cap Search Memory *(completed v0.79.0)*

**Goal:** Make search safe by default on large indexes without requiring users to know about `--early-cut` or `build-vss`.

**Implemented scope:**
- `vectorSearch()`: when `earlyCut` is not explicitly set (default 0), automatically reservoir-samples the candidate pool at 50 000 entries when the pool exceeds that threshold. Pass `earlyCut: -1` to disable the auto-cap. Explicit positive values continue to override.
- `search.ts`: replaced ~80-line manual usearch block with `vectorSearchWithAnn()`, which already handles HNSW threshold routing, fallback, and caching. Dual-model path also routes through `vectorSearchWithAnn()`. The `--vss` flag and auto-detect block continue to work — they simply pass `useVss: true` to the unified function.

**Status:** ✅ complete.

---

### Phase 83 — Parallel Commit-Message Embedding *(completed v0.80.0)*

**Goal:** Eliminate the serial O(commits × embedLatency) bottleneck in the commit-mapping phase.

**Implemented scope:**
- The commit-stream loop in `indexer.ts` now only performs synchronous SQLite work (`storeCommitWithBlobs`, `storeBlobBranches`). The blocking `await timedEmbed()` call has been removed from inside the loop.
- Commits needing message embedding are collected into a `toEmbed` queue during the stream pass.
- After the stream completes, all commit messages are embedded in parallel using the same `createLimiter(concurrency)` as blob embedding, converting serial wall-clock time to O(commits / concurrency × embedLatency).
- `markCommitIndexed()` is called per commit after its embedding completes (or fails) so incremental resume semantics are preserved.

**Status:** ✅ complete.

---

### Phase 84 — LSP: documentSymbol + Improved definition/references *(completed v0.81.0)*

**Goal:** Replace the LSP stubs with working implementations backed by the symbol index and vector search.

**Implemented scope:**
- `textDocument/definition`: four-tier lookup — (1) exact symbol name match, (2) substring LIKE match, (3) vector cosine over `symbolEmbeddings` table (up to 2 000 candidates), (4) file-level vector search fallback. Returns symbol name, kind, and precise line range.
- `textDocument/references`: merges (1) symbol-table hits by name (exact + LIKE) with (2) FTS5 blobs re-joined to the symbol index for line precision. FTS5 blobs without matching symbols fall back to file-level locations. Deduplicates by URI + line before returning.
- `textDocument/documentSymbol`: new handler — resolves file URI to the most-recent blob hash via paths + commits join, returns all symbols ordered by line as LSP `DocumentSymbol` objects with correct `SymbolKind` numbers.
- `initialize` response now advertises `documentSymbolProvider: true`.

**Status:** ✅ complete.

---

### Phase 85 — Tier-1 Reliability: Test Isolation, SQL Sampling, Batch Dedup *(completed v0.84.0)*

**Goal:** Eliminate all Windows-only test failures, push expensive JS-level operations into SQL, and replace per-blob deduplication queries with batch equivalents.

**Implemented scope:**

*Test fixes:*
- **EPERM on Windows (9 files):** all `afterAll` and inline cleanup blocks that called `rmSync(tmpDir)` while a `better-sqlite3` file handle remained open now call `session.rawDb.close()` first. Affected: `commitEmbedding`, `moduleEmbeddings`, `symbolEmbeddings`, `integration/indexAndSearch`, `integration/indexStatus`, `cherryPick`, `contributorProfile`, `docGap`, `multiRepo`.
- **Path-separator assertion** (`config.test.ts`): `getLocalConfigPath` assertion changed from a hardcoded POSIX string to `path.join(...)` so it produces the correct result on both Windows and Linux.
- **annSearch fixture isolation** (`annSearch.test.ts`): added `vi.mock('node:fs', ...)` to stub `existsSync` to `false`, preventing the tests from reading real `.gitsema/` VSS index files present in the workspace when coverage runs from the repo root.
- **`vi.mock` hoisting** (`mcpTools.test.ts`, `serverRoutes.test.ts`): session creation moved inside the mock factory so Vitest's static mock-hoisting transform does not reference variables before they are initialised.
- **CI OS matrix** (`.github/workflows/ci.yml`): added `strategy.matrix.os: [ubuntu-latest, windows-latest]` with `fail-fast: false` so failures on either OS are caught per-PR.

*SQL-level random sampling (`vectorSearch.ts`):*
- When the auto-cap is active (`earlyCut === 0`) and no `allowedHashes` pre-filter is provided, the main embeddings query now appends `ORDER BY RANDOM() LIMIT 50000` at the SQL level. Previously all rows were loaded into JS memory and then reservoir-sampled in JS — on a 500 K-blob index that wastefully allocated ~2 GB of row objects before discarding 90 % of them. The JS reservoir sample is retained as a safety fallback for chunk/symbol/module candidates appended to the pool after the primary query.

*Batch deduplication (`indexer.ts`):*
- The collection loop previously called `isIndexed(blobHash, model)` for every blob seen in the `git rev-list` stream — one synchronous SQLite round-trip per blob. For a 100 K-blob history that is 100 K separate queries.
- The loop now pushes all `(blobHash, model)` pairs into a `pending` list (with only the within-run `seenHashes` check and path filter applied inline). After the stream finishes, `filterNewBlobs()` is called once per distinct model, batching hashes in chunks of 500 using `blob_hash IN (…)`. The resulting `Set<string>` of new hashes filters `blobsToProcess` in a final pass.
- For a 100 K-blob repo this reduces collection-phase SQLite calls from 100 000 to ≤ 200, with no change in correctness.

*EmbedeerProvider (`src/core/embedding/embedeer.ts`):*
- Added a new provider type `embedeer` backed by the optional `@jsilvanus/embedeer` package. When selected, `models add --provider embedeer` automatically downloads and optimises the requested model. The provider otherwise falls back gracefully if the package is not installed.

**Status:** ✅ complete.

---

### Phase 86 — Tier-2 Code Organisation: MCP Modularization + Search Module Split + CLI Register Split *(completed v0.85.0)*

**Goal:** Complete the interrupted Tier-2 refactor from review6, repairing 12 broken TypeScript/test errors left by partial file moves.

**Implemented scope:**

*Broken-state repairs (12 errors):*
- `cli/index.ts`: removed duplicate content (file had been triple-concatenated during the interrupted refactor)
- `cli/register/all.ts`: fixed import path `fileDiff.js` → `diff.js`
- `search/clustering/clustering.ts`: fixed logger import path (`../../utils` → `../../../utils`)
- `temporal/changePoints.ts`: changed `computeEvolution` import from sibling file to parent re-export stub so vitest mocks apply correctly (fixed 7 test failures)
- `mcp/registerTool.ts`: widened `McpHandler` embed return type to `Embedding` (instead of `number[]`)
- `mcp/tools/*.ts`: added explicit `McpServer` type annotation on all four tool-registration functions; added `!` non-null assertions on embedding values after `ok` guard; made `health_timeline` handler `async`
- `mcp/tools/workflow.ts`: fixed import `computeAuthors` → `computeAuthorContributions`
- `ranking.ts`: added `showHeadings` parameter to `renderFirstSeenResults` (called with 2 args in two places)
- `labelEnhancer.ts`: added `chunks/chunking/chunked` token normalizations (failing test expectation)

*Architecture delivered (by the preceding commits):*
- `mcp/server.ts` split from 1,542 lines into 5 domain files (`tools/search.ts`, `tools/analysis.ts`, `tools/clustering.ts`, `tools/workflow.ts`, `tools/infrastructure.ts`) plus `registerTool()` helper
- `cli/index.ts` split from 1,593 lines into thin aggregator + `register/` domain files
- `src/core/search/` reorganized into `analysis/`, `clustering/`, `temporal/` subdirectories with backward-compat re-export stubs

**Tests:** 697/697 pass. Build: clean.

**Status:** ✅ complete.

---

### Phase 87 — Tier-3 Robustness: Embed Retry, Queue Backpressure, Atomic FTS5, Body Limit *(completed v0.86.0)*

**Goal:** Address the four production-readiness gaps identified in review6 Tier 3.

**Implemented scope:**

*Embedding retry with exponential backoff (`indexer.ts`):*
- Added `withRetry<T>(fn, maxAttempts=2, baseDelayMs=500)` helper inside the indexer.
- `timedEmbed()` now retries on transient errors: HTTP 429 (rate-limit), 503 (service unavailable), ECONNRESET, ETIMEDOUT. Non-transient errors propagate immediately.
- Backoff schedule: 500 ms before attempt 2. Two-attempt cap avoids long stalls on extended outages.

*AsyncQueue backpressure + error propagation (`asyncQueue.ts`):*
- Added optional `maxBufferSize` constructor option.
- New `pushAsync(item)` — `async`, blocks the caller when `items.length >= maxBufferSize` until a consumer calls `shift()`.
- New `pushError(err)` — marks the queue closed with an error; all blocking `pushAsync` calls and pending `shift()` calls receive the error.
- `shift()` now throws if the queue was closed via `pushError()`.
- Both pipeline queues in `indexer.ts` now use `{ maxBufferSize: 8 }` and `pushAsync()` to bound peak memory. Producer IIFE `.catch()` propagates crashes to the next stage.

*FTS5 content inside main transaction (`blobStore.ts`):*
- `storeFtsContent()` is now called inside the `db.transaction()` callback in both `storeBlob()` and `storeBlobRecord()`.
- Blob vector + FTS5 content are written atomically. A process crash between them can no longer leave a split-brain state where a blob is visible in vector search but absent from hybrid search.

*HTTP request body size limit (`server/app.ts`):*
- Replaced the hard-coded `'50mb'` Express body-parser limit with `process.env.GITSEMA_MAX_BODY_SIZE ?? '1mb'`.
- Prevents memory exhaustion from oversized POST bodies in shared deployments; override via env var for large-blob use cases.

**Tests:** 725/725. Build: clean.

**Status:** ✅ complete.

---

### Phase 88 — Tier-4 Scale/Features: LLM Narrator Tests + Docs Sync Check *(completed v0.87.0)*

**Goal:** Address the two Tier-4 proposals from review6: test coverage for the LLM narrator and automated documentation drift detection.

**Implemented scope:**

*LLM narrator test coverage (`tests/narrator.test.ts` — 19 tests):*
- Full unit coverage for `src/core/llm/narrator.ts` using `vi.stubGlobal('fetch', ...)` with canned `chat/completions` responses. Zero real HTTP calls.
- Tests cover all three fallback paths in `resolveLlmUrl()`: missing `GITSEMA_LLM_URL`, invalid URL, unsupported protocol (`ftp:`).
- Integration path tests: correct endpoint URL, Bearer token header, custom `GITSEMA_LLM_MODEL`, response content extraction.
- Error paths: HTTP error status → error fallback string, empty `choices` array → error fallback string.
- Functions covered: `narrateEvolution`, `narrateClusters`, `narrateSecurityFindings`, `narrateSearchResults`, `narrateChangePoints`.

*Documentation sync check (`tests/docsSync.test.ts` — 9 tests):*
- Guards against the doc drift identified in review6 §9.2.
- Checks: `CLAUDE.md` contains the current schema version from `sqlite.ts` (`CURRENT_SCHEMA_VERSION`), README.md mentions all non-hidden CLI commands (tolerance ≤ 5 missing for forward-compat), canonical docs (`features.md`, `PLAN.md`, latest `review*.md`) exist and are non-trivial, `package.json` has a valid semver version at ≥ 0.80.0.
- `CLAUDE.md` updated: schema version corrected from v17 → v19.

**Tests:** 725/725 (62 files). Build: clean.

**Status:** ✅ complete.

---

### Phase 89 — Tier-5 Code Quality: review6 §11 Detailed Findings *(completed v0.88.0)*

**Goal:** Address the six detailed code findings in review6 §11 that were
explicitly outside the numbered Tier-1–4 proposal list but still represent
correctness, maintainability, and schema-integrity bugs. Also collapse the
stray `src/core/search/core/` duplicates (`vectorSearch.ts`, `hybridSearch.ts`,
`resultCache.ts`) left over from the Phase 86 refactor into re-export shims so
subsequent fixes only need one edit site.

**Implemented scope:**

*§11.1 — vectorSearch cache-key collision (`resultCache.ts`, `vectorSearch.ts`):*
- Added `allowedHashesFingerprint(allowed?)` helper in `analysis/resultCache.ts`
  — `sha1(sorted(hashes)).slice(0,16) + ':' + size`, or `null` when absent.
- `vectorSearch()` now includes that fingerprint in `cacheKeyOptions` so two
  calls with the same query text but different `allowedHashes` filters (e.g.
  different branch-scoped searches) no longer collide on the cache entry left
  behind by a prior unfiltered call.
- Collapsed `core/resultCache.ts` and `core/vectorSearch.ts` into re-export
  shims pointing at `analysis/` so cache state is unified (the old duplicate
  `cache` Map in `core/resultCache.ts` was never invalidated by
  `invalidateResultCache()`, a latent bug).

*§11.2 — hybridSearch BM25 `range === 0` edge case (`hybridSearch.ts`):*
- When every candidate row had an identical BM25 score, normalisation set
  all scores to 1.0 and inflated the hybrid fusion beyond the intended
  weight distribution. Now returns 0.5 (neutral midpoint) instead.
- `core/hybridSearch.ts` collapsed to a re-export shim for the same
  drift-prevention reason as §11.1.

*§11.3 — Ollama batch fallback control flow (`local.ts`):*
- Restructured `embedBatch()` so that only a 404 response triggers the
  sequential fallback. Network-layer errors (ECONNREFUSED, ETIMEDOUT) and
  non-404 HTTP errors now propagate to the caller unchanged, so upstream
  retry/backoff (added in Phase 87) can react. Previously the confusing
  double-negated catch block could swallow unrelated error types when
  `_batchEndpointUnavailable` was set mid-call.

*§11.4 — `bufferToEmbedding` duplication (`src/utils/embedding.ts`):*
- The helper was privately re-declared in **13 different files** across
  `src/core/search/`, `src/server/routes/`, and `src/cli/commands/`. Any
  change to the storage format (e.g. future quantization work) would have
  required 13 identical edits with zero compile-time enforcement.
- New module `src/utils/embedding.ts` exports `bufferToFloat32(buf)` (the
  zero-copy Float32Array view used in hot paths) and `bufferToEmbedding(buf)`
  (the `number[]` variant used where a retainable copy is needed).
- All 13 call sites now import from the shared util. Local duplicates have
  been deleted.

*§11.5 — within-run dedup `SIZE_CAP` warning + correctness (`indexer.ts`):*
- Added a one-time `logger.warn()` when `seenHashes` exceeds the 50 000-entry
  cap and is cleared, so operators can see that the rare branch fired.
- **Bonus correctness fix:** before this change, clearing `seenHashes`
  mid-stream could let the same blob hash appear twice in the `pending[]`
  list. Both copies would pass `filterNewBlobs()` (which queries the DB
  state *before* the run started) and a genuinely new blob would be
  embedded twice. Added an authoritative `pendingSeen` dedup pass between
  the stream loop and the byModel grouping so the `SIZE_CAP` clear is safe
  under all conditions.

*§11.6 — UNIQUE `(blob_hash, path)` constraint on paths table (schema v20):*
- New migration v19 → v20 in `sqlite.ts`: deletes duplicate `paths` rows
  (keeping lowest `id`) then creates `idx_paths_blob_path_unique` as a
  unique index on `(blob_hash, path)`.
- `initTables()` (fresh-DB path) creates the same unique index.
- `src/core/db/schema.ts` `paths` table gains a `uniqueIndex` so Drizzle
  tracks it.
- `storeBlob()` and `storeBlobRecord()` in `blobStore.ts` now call
  `.onConflictDoNothing()` on the paths insert so writers remain idempotent
  for the same `(blob_hash, path)` pair.
- `CURRENT_SCHEMA_VERSION` bumped to **20**; `CLAUDE.md` schema overview
  header + migration list updated to match (required by the Phase 88
  docsSync test).

**Tests:** 725/725 (62 files). Build: clean.

**Status:** ✅ complete.

---

### Phase 90 — Model Local Names (Shorthand / globalName) *(completed v0.89.0)*

**Goal:** Allow users to register a gitsema model under a short local name
(shorthand) while keeping a separate *global name* that is sent verbatim to the
embedding provider (Ollama, OpenAI-compatible HTTP, embedeer). This enables:

- Convenient CLI usage with short names (`my-embed`) while the provider
  receives the full remote identifier (`hf.co/org/model:latest`).
- Multiple local aliases for the same remote model, each with distinct prefix
  or level settings.
- Multi-provider setups where the same conceptual model lives under different
  names on different backends.

**Implemented scope:**

*`ModelProfile.globalName` field (`src/core/config/configManager.ts`):*
- Added `globalName?: string` to `ModelProfile` interface.
- The config key `models.<localName>` is the shorthand used everywhere in
  gitsema CLI arguments; `globalName` is the model identifier forwarded to
  the provider.
- When absent, the local name is used as-is (fully backward-compatible).
- `getModelProfile()` merges `globalName` with standard local-wins-over-global
  precedence alongside all other profile fields.

*Provider resolution (`src/core/embedding/providerFactory.ts`):*
- `buildProviderForModel()`, `getTextProvider()`, and `getCodeProvider()` all
  resolve `profile.globalName ?? localName` before constructing the
  `OllamaProvider`, `HttpProvider`, or `EmbedeerProvider` instance.
- No changes to any call site — resolution is fully transparent.

*CLI commands (`src/cli/commands/models.ts`):*
- `ModelsAddOptions` gains `globalName?: string`.
- `modelsAddCommand()` and `modelsUpdateCommand()` write `globalName` to the
  profile when `--global-name <name>` is supplied.
- `printProfile()` displays `globalName` when set.
- `modelsInfoCommand()` shows `(shorthand for: <globalName>)` below the model
  name when a globalName is configured.
- `modelsListCommand()` adds a `→ Global name` column to the tabular output
  (only rendered when at least one model has a `globalName` configured, so the
  table is unchanged for setups that don't use the feature).

*CLI registration (`src/cli/register/setup.ts`):*
- `--global-name <name>` option added to both `models add` and `models update`
  subcommands with a clear description.
- Help text extended with a usage example.

*Tests (`tests/modelGlobalName.test.ts`):*
- 11 new tests covering: storage/retrieval, independent updates, last-write
  wins, coexistence with prefixes/extRoles, provider resolution for Ollama,
  HTTP, and fallback to local name.

**Tests:** build clean, existing suite passes. **Status:** ✅ complete.

---

### Phase 91 — 8 Productized Usage Patterns (review7 §5) *(completed v0.90.0)*

**Goal:** Implement all 8 productized usage patterns described in `docs/review7.md` §5
as concrete, user-accessible features with CLI commands, documentation, and smoke tests.

**Patterns implemented:**

| # | Pattern | Template name | Key sources |
|---|---------|---------------|-------------|
| 1 | PR Semantic Risk Gate | `pr-review` | impact + changePoints + experts |
| 2 | Release Narrative Pack | `release-audit` | vectorSearch + changePoints + experts |
| 3 | Onboarding Assistant | `onboarding` | vectorSearch + changePoints + keyExperts |
| 4 | Incident Triage Console | `incident` | firstSeen + changePoints + experts |
| 5 | Ownership Intelligence | `ownership-intel` | computeAuthorContributions + vectorSearch |
| 6 | Architecture Drift Monitor | `arch-drift` | computeHealthTimeline + scoreDebt + changePoints |
| 7 | Knowledge Discovery Portal | `knowledge-portal` | vectorSearch + changePoints + experts |
| 8 | Regression Forecasting | `regression-forecast` | vectorSearch + changePoints + experts + ref hint |

**Implemented scope:**

*`src/cli/commands/workflow.ts`:*
- Expanded `TEMPLATES` from 3 to 8 entries (all 8 patterns).
- Added `TEMPLATE_DESCRIPTIONS` export mapping each template to a human-readable description.
- Added `WorkflowOptions.role` (alias for `--role <topic>` in onboarding) and `WorkflowOptions.ref` (base ref for regression-forecast).
- Added `workflowListCommand()` — prints all 8 templates with descriptions (no DB/embedding needed).
- New patterns: `onboarding`, `ownership-intel`, `arch-drift`, `knowledge-portal`, `regression-forecast`.
- Imports added: `computeAuthorContributions`, `scoreDebt`, `computeHealthTimeline`, `getActiveSession`.

*`src/cli/register/all.ts`:*
- Updated `workflow run` description and added `--role`, `--ref` options.
- Added `workflow list` subcommand wired to `workflowListCommand`.

*`docs/patterns.md` (new):*
- Comprehensive documentation for all 8 patterns: goal, example invocation, output sections table, flags, CI example.

*`tests/workflow.test.ts`:*
- Extended from 5 to 17 tests.
- Added mocks for `authorSearch`, `debtScoring`, `healthTimeline`, `sqlite`.
- Tests for all 5 new patterns (happy path + error paths for required flags).
- Tests for `workflowListCommand` and `TEMPLATE_DESCRIPTIONS`.

**Tests:** 17 workflow tests pass. Full suite green. **Status:** ✅ complete.

---


### Phase 92 — review7 Improvement Bundle *(completed, 2026-04-09)*

**Goal:** Implement the 8 concrete improvement points from `docs/review7.md`.

**Implemented scope:**

*§4.1 — Hash repo tokens at rest (schema v21):*
- `repo_tokens` table rebuilt with `token_hash TEXT PRIMARY KEY` + `token_prefix TEXT NOT NULL` replacing the plaintext `token` PK.
- `initTables()` creates the new schema for fresh DBs.
- Migration v20 → v21: hashes all existing plaintext tokens with SHA-256, stores first-8-char prefix; uses JS `createHash` (crypto module) inside `applyMigrations()`.
- `authMiddleware` now hashes incoming Bearer tokens with `createHash('sha256')` before DB lookup — plaintext is never stored or compared.
- `gitsema repos token add` stores `token_hash` + `token_prefix`, never plaintext. `list` shows prefix only. `revoke` uses prefix LIKE query on `token_prefix`.
- `CURRENT_SCHEMA_VERSION` bumped to **21**.

*§4.2 — Narrator timeout + retry budget:*
- `callLlm()` in `narrator.ts` now wraps each `fetch` in an `AbortController` with a configurable timeout (`GITSEMA_LLM_TIMEOUT` env, default 30 s).
- On `AbortError` (timeout), retries up to `GITSEMA_LLM_RETRIES` (default 1) times before returning a structured failure message that includes "timed out".

*§4.3 — Structured ANN warning on failure:*
- `annSearch()` in `vectorSearch.ts` now catches errors and calls `logger.warn('[ANN] ...')` with the model name and error message instead of returning null silently. Operators can now detect HNSW index corruption or mismatches in logs.

*§4.4 — SQL-level candidate filtering (chunk/symbol/module):*
- Chunk, symbol, and module queries in `vectorSearch()` now carry `.limit(CAP)` **before** rows are materialised into JS. This prevents OOM on large indexes when `--chunks` or `--symbols` is enabled.

*§4.5 — Per-mode row caps with warnings:*
- Four configurable caps added: `GITSEMA_FILE_CAP` (50K), `GITSEMA_CHUNK_CAP` (25K), `GITSEMA_SYMBOL_CAP` (25K), `GITSEMA_MODULE_CAP` (5K). When a cap is hit `logger.warn` emits the cap value and the override env var.

*§4.6 — Role-based quickstart playbooks:*
- New `docs/playbooks.md` with concrete command sequences for four roles: solo developer, PR reviewer, security engineer, release manager.

*§4.7 — Task-oriented command map in README:*
- Added "Find the right command by goal" table to `README.md` (between the command group table and the detailed reference), with 20 goal → command rows covering the most common scenarios.

*§4.8 — Team operations guidance in docs/deploy.md:*
- New §11 "Team operations" in `docs/deploy.md` covering: token security, token rotation policy (90-day cadence + emergency rotation), audit logs (nginx + journal + Prometheus alert), backup/restore (hot SQLite backup, cron schedule, quarterly drill procedure), and health checks.

**Tests:** Added `tests/review7.test.ts` (5 tests: token hashing invariants, ANN structured warning). Narrator timeout/retry tests added to `tests/narrator.test.ts` (3 new tests: timeout-no-retry, timeout-with-retry, custom timeout env var). All 27 tests in affected files pass.

**Documentation:** `CLAUDE.md` schema overview updated to v21 + migration v20→v21 entry added. `docs/deploy.md` table of contents updated with §11.

**Status:** ✅ complete.

### Phase 93 — Time filter semantics & pagination stability

**Goal:** Fix temporal filter semantics and stabilize `search_after` pagination to ensure correct, deterministic temporal filtering and robust paginated search results.

**Description:** Implement fixes from PR #67 and PR #68 (issues #65 and #66). The changes:
- Use repository "last-seen" timestamps (commit-based) when evaluating `--after` / `--before` filters so that time filters reflect when a blob was last observed in history rather than first-seen semantics.
- Accept commit-ish refs (tags, branch names, and commit hashes) in `--after` / `--before` arguments by resolving them to commit timestamps.
- Stabilize `search_after` pagination in vector search to avoid skipping or duplicating results across pages (deterministic tie-breaking and consistent sort keys).

**Acceptance criteria:**
- `gitsema search --after <ref|date>` and `--before <ref|date>` use last-seen timestamps, not first-seen timestamps.
- `--after`/`--before` accept git commit-ish refs (branch, tag, commit) and behave identically to supplying the resolved commit date.
- Integration test `tests/integration/timeFilters.test.ts` passes and asserts correct temporal filtering and pagination determinism.
- No regressions in existing search integration tests (run `pnpm test`).

**Files changed:**
- `src/core/search/temporal/timeSearch.ts`
- `src/core/search/analysis/vectorSearch.ts`
- `tests/integration/timeFilters.test.ts`

**Tests & commands:**
- Run full test suite: `pnpm test`
- Run focused integration test: `pnpm test -- tests/integration/timeFilters.test.ts`

**Impact:** Fixes incorrect temporal filtering and pagination bugs that could cause missing or duplicated results in time-scoped searches and break pagination stability for large result sets. Backwards-compatible for most callers; command-line semantics for `--after` / `--before` are now more intuitive.

**Rollback plan:** Revert the merge commit(s) for PR #67 and PR #68 and re-run the test suite. If necessary, revert only the specific functions in `timeSearch.ts` / `vectorSearch.ts` and reapply a hotfix branch.

PRs: https://github.com/jsilvanus/gitsema/pull/67, https://github.com/jsilvanus/gitsema/pull/68

## Long-Term Investments

| Feature | Complexity | Notes |
|---------|:----------:|-------|
| DuckDB / pgvector migration path | High | For corpora >500K blobs; keep SQLite as default |
| Plugin API for custom analysers | High | Allow third-party modules to register their own search/analysis commands |

**Scale notes (updated for v0.81.0):**

- **Search memory:** auto early-cut (Phase 82) now guards the default search path — reservoir sampling kicks in at 50 K candidates without any flags. ANN path (`gitsema index build-vss`) eliminates the candidate-load entirely for large indexes.
- **Indexing time:** commit-message embedding is now parallelised (Phase 83). The read/embed/store pipeline (Phase 69) + parallel commit embedding together keep both phases off the critical path. The remaining serial bottleneck is commit-graph walking itself (git rev-list) which is I/O-bound.
- **Chunk/symbol candidate expansion:** when `--chunks` or `--vss` is combined with a large index the candidate pool grows 3–10× before scoring. Monitor RSS when indexing large monorepos with `--chunker function`.

## Non-goals for now (revisited later)

| Feature | Reasoning | 
|---------|:----------:|-------|
| Python model server (GPU Docker) | We already have Node.js embedeer and if we want Docker+python, we can use ollama. |

---
