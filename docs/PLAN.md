# gitsema — Refined Development Plan

> A Git-aware semantic search engine that treats code history as a time-indexed semantic dataset.

---

## Table of Contents

| Section | Line |
|---|---:|
| [Vision](#vision) | 127 |
| [Guiding principles](#guiding-principles) | 133 |
| [Architecture overview](#architecture-overview) | 143 |
| [Project structure](#project-structure) | 163 |
| [Section I - Phases](#section-i-phases) | 215 |
|   [Phase 1 — Foundation](#phase-1-—-foundation) | 217 |
|   [Phase 2 — Git walking](#phase-2-—-git-walking) | 259 |
|   [Phase 3 — Embedding system](#phase-3-—-embedding-system) | 283 |
|   [Phase 4 — Indexing](#phase-4-—-indexing) | 321 |
|   [Phase 5 — Search  ·  *MVP deliverable*](#phase-5-—-search-·-mvp-deliverable) | 347 |
|   [Phase 6 — Commit mapping](#phase-6-—-commit-mapping) | 380 |
|   [Phase 7 — Time-aware queries  ·  *Phase 2 deliverable*](#phase-7-—-time-aware-queries-·-phase-2-deliverable) | 417 |
|   [Phase 8 — File-type-aware embedding models](#phase-8-—-file-type-aware-embedding-models) | 450 |
|   [Phase 9 — Performance](#phase-9-—-performance) | 488 |
|   [Phase 10 — Smarter semantics](#phase-10-—-smarter-semantics) | 526 |
|   [Phase 11 — Advanced features + MCP](#phase-11-—-advanced-features-mcp) | 571 |
|   [Phase 11b — Content access and semantic concept tracking](#phase-11b-—-content-access-and-semantic-concept-tracking) | 642 |
| [Key technical decisions](#key-technical-decisions) | 759 |
| [Risk register](#risk-register) | 771 |
|   [Phase 12 — CLI consolidation & robust per-file indexing](#phase-12-—-cli-consolidation-robust-per-file-indexing) | 783 |
|   [Recent progress (snapshot: 2026-04-01)](#recent-progress-snapshot-2026-04-01) | 813 |
|   [Phase 13 — Standalone model server for embeddings](#phase-13-—-standalone-model-server-for-embeddings) | 829 |
|   [Phase 14 — Infrastructure, tooling, and maintenance](#phase-14-—-infrastructure-tooling-and-maintenance) | 912 |
|   [Phase 14b — Search result deduplication](#phase-14b-—-search-result-deduplication) | 969 |
|   [Phase 15 — Branch awareness](#phase-15-—-branch-awareness) | 1003 |
|   [Phase 16 — Remote-repository indexing (server-managed clone, RAM-backed working tree, persistent DB)](#phase-16-—-remote-repository-indexing-server-managed-clone-ram-backed-working-tree-persistent-db) | 1075 |
|   [Phase 17 — Remote-indexing hardening and SSH support](#phase-17-—-remote-indexing-hardening-and-ssh-support) | 1333 |
|   [Phase 18 — Reliability, tests, and query caching](#phase-18-—-reliability-tests-and-query-caching) | 1404 |
|   [Phase 19 — Smarter chunking, semantic blame & symbol-level embeddings](#phase-19-—-smarter-chunking-semantic-blame-symbol-level-embeddings) | 1418 |
|   [Phase 20 — Dead-concept detection & refactor impact analysis](#phase-20-—-dead-concept-detection-refactor-impact-analysis) | 1483 |
|   [Phase 21 — Semantic clustering & concept graph](#phase-21-—-semantic-clustering-concept-graph) | 1496 |
|   [Phase 22 — Temporal cluster diff](#phase-22-—-temporal-cluster-diff) | 1509 |
|   [Phase 23 — Cluster timeline](#phase-23-—-cluster-timeline) | 1522 |
|   [Phase 24 — Enhanced cluster labeling](#phase-24-—-enhanced-cluster-labeling) | 1536 |
|   [Phase 25 — Interactive HTML visualizations](#phase-25-—-interactive-html-visualizations) | 1550 |
|   [Phase 26 — CLI naming consolidation & conceptual diff](#phase-26-—-cli-naming-consolidation-conceptual-diff) | 1565 |
|   [Phase 27 — Semantic change-point detection](#phase-27-—-semantic-change-point-detection) | 1606 |
|   [Phase 28 — Persistent configuration management](#phase-28-—-persistent-configuration-management) | 1666 |
|   [Phase 29 — Automated indexing via Git hooks](#phase-29-—-automated-indexing-via-git-hooks) | 1693 |
|   [Phase 30 — Commit message semantic indexing](#phase-30-—-commit-message-semantic-indexing) | 1709 |
|   [Phase 31 — Semantic concept authorship ranking](#phase-31-—-semantic-concept-authorship-ranking) | 1760 |
|   [Phase 32 — Branch and merge awareness](#phase-32-—-branch-and-merge-awareness) | 1810 |
|   [Phase 33 — Multi-level hierarchical indexing](#phase-33-—-multi-level-hierarchical-indexing) | 1871 |
|   [Phase 34 — Feature adoption & cross-cutting improvements](#phase-34-—-feature-adoption-cross-cutting-improvements) | 1927 |
|   [Phase 35 — Multi-model DB, per-command model flags, clear-model, multi-model search](#phase-35-—-multi-model-db-per-command-model-flags-clear-model-multi-model-search) | 1965 |
|   [Phase 36 — Vector Index (VSS), Int8 Quantization, ANN Search](#phase-36-—-vector-index-vss-int8-quantization-ann-search) | 2003 |
|   [Phase 37 — Quick Wins: Selective Indexing, Code-to-Code Search, Negative Examples, Result Explanation](#phase-37-—-quick-wins-selective-indexing-code-to-code-search-negative-examples-result-explanation) | 2077 |
|   [Phase 38 — Medium Effort: Documentation Gap Analysis, Semantic Bisect, GC, Boolean Queries](#phase-38-—-medium-effort-documentation-gap-analysis-semantic-bisect-gc-boolean-queries) | 2102 |
|   [Phase 39 — Analysis Features: Contributor Profiles, Refactoring, Lifecycle, CI Diff](#phase-39-—-analysis-features-contributor-profiles-refactoring-lifecycle-ci-diff) | 2127 |
|   [Phase 40 — Visualization & Scale: Codebase Map, Temporal Heatmap, Remote Index, Cherry-Pick](#phase-40-—-visualization-scale-codebase-map-temporal-heatmap-remote-index-cherry-pick) | 2152 |
|   [Phase 41 — Multi-Repo Unified Index *(completed v0.43.0)*](#phase-41-—-multi-repo-unified-index-completed-v0430) | 2183 |
|   [Phase 42 — IDE / LSP Integration *(completed v0.44.0)*](#phase-42-—-ide-lsp-integration-completed-v0440) | 2199 |
|   [Phase 43 — Security Pattern Detection *(completed v0.45.0)*](#phase-43-—-security-pattern-detection-completed-v0450) | 2215 |
|   [Phase 44 — Codebase Health Timeline *(completed v0.46.0)*](#phase-44-—-codebase-health-timeline-completed-v0460) | 2230 |
|   [Phase 45 — Technical Debt Scoring *(completed v0.47.0)*](#phase-45-—-technical-debt-scoring-completed-v0470) | 2245 |
|   [Phase 46 — Evolution Alerts and Commit URL Construction *(completed v0.48.0)*](#phase-46-—-evolution-alerts-and-commit-url-construction-completed-v0480) | 2262 |
|   [Phase 47 — Richer Indexing Progress, Embed Latency Stats, and Incremental-by-Default Messaging](#phase-47-—-richer-indexing-progress-embed-latency-stats-and-incremental-by-default-messaging) | 2277 |
|   [Phase 48 — Batch Embedding and Provider Throughput ✅ Implemented](#phase-48-—-batch-embedding-and-provider-throughput-✅-implemented) | 2307 |
|   [Phase 49 — Auto-VSS Default Path ✅ Implemented (v0.51.0)](#phase-49-—-auto-vss-default-path-✅-implemented-v0510) | 2322 |
|   [Phase 50 — Real Multi-Repo Search ✅ Implemented (v0.52.0)](#phase-50-—-real-multi-repo-search-✅-implemented-v0520) | 2334 |
|   [Phase 51 — LSP Completion of the Protocol ✅ Implemented (v0.53.0)](#phase-51-—-lsp-completion-of-the-protocol-✅-implemented-v0530) | 2346 |
|   [Phase 52 — Query Expansion ✅ Implemented (v0.54.0)](#phase-52-—-query-expansion-✅-implemented-v0540) | 2359 |
|   [Phase 53 — Saved Searches and Watch Mode ✅ Implemented (v0.55.0)](#phase-53-—-saved-searches-and-watch-mode-✅-implemented-v0550) | 2371 |
|   [Phase 54 — Index Bundle Export / Import ✅ Implemented (v0.56.0)](#phase-54-—-index-bundle-export-import-✅-implemented-v0560) | 2383 |
|   [Phase 55 — Embedding Space Explorer (Web UI) ✅ Implemented (v0.57.0)](#phase-55-—-embedding-space-explorer-web-ui-✅-implemented-v0570) | 2394 |
|   [Phase 56 — LLM-Powered Evolution Narration ✅ Implemented (v0.58.0)](#phase-56-—-llm-powered-evolution-narration-✅-implemented-v0580) | 2405 |
|   [Phase 57 — GitHub Actions Integration for CI Diff ✅ Implemented (v0.59.0)](#phase-57-—-github-actions-integration-for-ci-diff-✅-implemented-v0590) | 2416 |
|   [Phase 58 — Structured Security Scan (Static + Semantic) ✅ Implemented (v0.60.0)](#phase-58-—-structured-security-scan-static-semantic-✅-implemented-v0600) | 2427 |
|   [Phase 59 — `gitsema tools` Subcommand Group (Protocol Servers) ✅ Implemented (v0.61.0)](#phase-59-—-gitsema-tools-subcommand-group-protocol-servers-✅-implemented-v0610) | 2439 |
|   [Phase 60 — Uniform Column Headers + `--no-headings` Across All Commands ✅ Implemented (v.0.62.0)](#phase-60-—-uniform-column-headers-no-headings-across-all-commands-✅-implemented-v0620) | 2480 |
|   [Phase 61 — MCP/HTTP Parity + Semantic PR Report *(completed v0.64.0)*](#phase-61-—-mcphttp-parity-semantic-pr-report-completed-v0640) | 2545 |
|   [Phase 62 — Heavy Batching for Ollama + HTTP Providers *(completed v0.67.0)*](#phase-62-—-heavy-batching-for-ollama-http-providers-completed-v0670) | 2565 |
|   [Phase 63 — Indexing Auto-Defaults and Adaptive Tuning *(completed v0.65.0)*](#phase-63-—-indexing-auto-defaults-and-adaptive-tuning-completed-v0650) | 2579 |
|   [Phase 64 — Search Scalability + AI Retrieval Reliability *(completed v0.66.0)*](#phase-64-—-search-scalability-ai-retrieval-reliability-completed-v0660) | 2595 |
|   [Phase 65 — Incident Triage Bundle *(completed v0.68.0)*](#phase-65-—-incident-triage-bundle-completed-v0680) | 2609 |
|   [Phase 66 — Policy Checks for CI *(completed v0.68.0)*](#phase-66-—-policy-checks-for-ci-completed-v0680) | 2617 |
|   [Phase 67 — Ownership Heatmap by Concept *(completed v0.68.0)*](#phase-67-—-ownership-heatmap-by-concept-completed-v0680) | 2625 |
|   [Phase 68 — Persistent Workflow Templates *(completed v0.68.0)*](#phase-68-—-persistent-workflow-templates-completed-v0680) | 2633 |
|   [Phase 69 — Pipelined Batch Indexing *(completed v0.68.0)*](#phase-69-—-pipelined-batch-indexing-completed-v0680) | 2641 |
|   [Phase 70 — Unified Output System *(completed v0.69.0)*](#phase-70-—-unified-output-system-completed-v0690) | 2649 |
|   [Phase 71 — Index Status Dashboard + Model Management *(completed v0.71.0)*](#phase-71-—-index-status-dashboard-model-management-completed-v0710) | 2666 |
|   [Planned Phases (72+)](#planned-phases-72) | 2688 |
|   [Phase 71 — Operational Readiness: Metrics, Rate Limiting, and OpenAPI *(completed v0.71.0)*](#phase-71-—-operational-readiness-metrics-rate-limiting-and-openapi-completed-v0710) | 2694 |
|   [Phase 72 — HTTP Route Parity for All Analysis Commands *(completed v0.72.0)*](#phase-72-—-http-route-parity-for-all-analysis-commands-completed-v0720) | 2707 |
|   [Phase 73 — Deployment Guide and Docker Infrastructure](#phase-73-—-deployment-guide-and-docker-infrastructure) | 2719 |
|   [Phase 74 — `gitsema status` Scale Warnings + Extended `gitsema doctor` Pre-flight](#phase-74-—-gitsema-status-scale-warnings-extended-gitsema-doctor-pre-flight) | 2732 |
|   [Phase 75 — Per-Repo Access Control on HTTP Server](#phase-75-—-per-repo-access-control-on-http-server) | 2745 |
|   [Phase 76 — Complete `htmlRenderer.ts` Modularisation](#phase-76-—-complete-htmlrendererts-modularisation) | 2759 |
|   [Phase 77 — Unified Indexing + Search Level Concept](#phase-77-—-unified-indexing-search-level-concept) | 2772 |
|   [Phase 82 — Auto-cap Search Memory *(completed v0.79.0)*](#phase-82-—-auto-cap-search-memory-completed-v0790) | 2788 |
|   [Phase 83 — Parallel Commit-Message Embedding *(completed v0.80.0)*](#phase-83-—-parallel-commit-message-embedding-completed-v0800) | 2800 |
|   [Phase 84 — LSP: documentSymbol + Improved definition/references *(completed v0.81.0)*](#phase-84-—-lsp-documentsymbol-improved-definitionreferences-completed-v0810) | 2814 |
|   [Phase 85 — Tier-1 Reliability: Test Isolation, SQL Sampling, Batch Dedup *(completed v0.84.0)*](#phase-85-—-tier-1-reliability-test-isolation-sql-sampling-batch-dedup-completed-v0840) | 2828 |
|   [Phase 86 — Tier-2 Code Organisation: MCP Modularization + Search Module Split + CLI Register Split *(completed v0.85.0)*](#phase-86-—-tier-2-code-organisation-mcp-modularization-search-module-split-cli-register-split-completed-v0850) | 2856 |
|   [Phase 87 — Tier-3 Robustness: Embed Retry, Queue Backpressure, Atomic FTS5, Body Limit *(completed v0.86.0)*](#phase-87-—-tier-3-robustness-embed-retry-queue-backpressure-atomic-fts5-body-limit-completed-v0860) | 2884 |
|   [Phase 88 — Tier-4 Scale/Features: LLM Narrator Tests + Docs Sync Check *(completed v0.87.0)*](#phase-88-—-tier-4-scalefeatures-llm-narrator-tests-docs-sync-check-completed-v0870) | 2916 |
|   [Phase 89 — Tier-5 Code Quality: review6 §11 Detailed Findings *(completed v0.88.0)*](#phase-89-—-tier-5-code-quality-review6-§11-detailed-findings-completed-v0880) | 2940 |
|   [Phase 90 — Model Local Names (Shorthand / globalName) *(completed v0.89.0)*](#phase-90-—-model-local-names-shorthand-globalname-completed-v0890) | 3020 |
|   [Phase 91 — 8 Productized Usage Patterns (review7 §5) *(completed v0.90.0)*](#phase-91-—-8-productized-usage-patterns-review7-§5-completed-v0900) | 3075 |
|   [Phase 92 — review7 Improvement Bundle *(completed, 2026-04-09)*](#phase-92-—-review7-improvement-bundle-completed-2026-04-09) | 3121 |
|   [Phase 93 — Time filter semantics & pagination stability](#phase-93-—-time-filter-semantics-pagination-stability) | 3163 |
|   [Phase 94 — review8 CLI Wiring & Documentation Restoration *(completed v0.91.0)*](#phase-94-—-review8-cli-wiring-documentation-restoration-completed-v0910) | 3193 |
|   [Phase 95 — Flag unification (review8 §8.6/§8.9) *(completed v0.92.0)*](#phase-95-—-flag-unification-review8-§86§89-completed-v0920) | 3225 |
|   [Phase 96 — LLM Narrator/Explainer/Guide via chattydeer *(completed v0.93.0)*](#phase-96-—-llm-narratorexplainerguide-via-chattydeer-completed-v0930) | 3248 |
|   [Phase 97 — Full-toolset guide, tool interpretation registry, skill generation, Ollama docs](#phase-97-—-full-toolset-guide-tool-interpretation-registry-skill-generation-ollama-docs) | 3281 |
|   [Phase 98 — CLI-based AI tool backends for narrator/guide](#phase-98-—-cli-based-ai-tool-backends-for-narratorguide) | 3342 |
|   [Phase 99 — `--provider ollama` for narrator/guide + Ollama model discovery](#phase-99-—-provider-ollama-for-narratorguide-ollama-model-discovery) | 3406 |
| [Long-Term Investments](#long-term-investments) | 3447 |
| [Non-goals for now (revisited later)](#non-goals-for-now-revisited-later) | 3464 |
|   [Phase 100 — Persistent, registry-backed server-side repo storage](#phase-100-—-persistent-registry-backed-server-side-repo-storage) | 3472 |
|   [Phases 101–103 — Pluggable storage backends & index scoping](#phases-101–103-—-pluggable-storage-backends-index-scoping) | 3540 |
|   [Phase 104 — Full-toolset guide coverage, per-command `--narrate`, and a guided `gitsema setup` wizard](#phase-104-—-full-toolset-guide-coverage-per-command-narrate-and-a-guided-gitsema-setup-wizard) | 3742 |
| [Knowledge Graph Track (Phases 105–112) — ✅ complete](#knowledge-graph-track-phases-105–112-—-complete) | 3888 |

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
| Slow cosine search at scale | ✅ Resolved: usearch HNSW VSS (Phase 36/49) for SQLite; `pgvector`/Qdrant ANN backends (Phases 102-103) for postgres/qdrant |

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

### Phase 94 — review8 CLI Wiring & Documentation Restoration *(completed v0.91.0)*

**Goal:** Address the CLI-wiring, usability, and documentation-parity findings from `docs/review8.md`.

**Implemented scope:**

*§2 — Broken wiring (six unreachable commands):*
- `registerAnalysis(program)` is now called from `registerAll`; the duplicate definitions of `eval`, `repl`, `quickstart`, `regression-gate`, `cross-repo-similarity`, and `code-review` were removed from `all.ts` so `analysis.ts` is the single source for analysis commands.
- Re-registered `first-seen` and `file-evolution` (handlers were intact but orphaned).
- `pr-report`, `triage`, `ownership`, and `policy-check` (renamed from `policy check` to match the kebab-case convention) are now reachable.
- The misleading comment at `all.ts:147` was corrected.

*§4 — Shared CLI helpers:*
- Extracted `buildProviderOrExit`, model-override resolution, and the JSON/sink output epilogue into shared `src/cli/lib/` helpers, removing ~500 lines of drifted copy-paste across ~14–35 command files.
- Adopted an exit-code scheme (0 ok / 1 runtime error / 2 usage error / 3 gate failed) for the CI-facing commands: `ci-diff`, `regression-gate`, `code-review`, `policy-check`.
- Added `.description()` to the `workflow` parent command.

*§6 — Search-module reorg completion:*
- Finished the `src/core/search/` reorganization: removed the top-level shims, the `core/` shim directory (including the duplicated `booleanSearch.ts`), and the barrel `src/core/search/index.ts`. Canonical implementations now live under `analysis/`, `temporal/`, and `clustering/`; imports and tests updated accordingly.

*§6 — Repo root cleanup:*
- Removed stale `package-lock.json`/`yarn.lock`, the vestigial root `index.js`, `index.log`, `tmp/search-backups/`, and ad-hoc notes (`plan3.md`, `ISSUE_BODY_search_after.md`); added `tmp/` and `*.log` to `.gitignore`. Folded `src/core/phase41plus.ts`'s note into this plan and removed the file.

*§5 — Documentation restoration:*
- Rebuilt `README.md` from a 9-line stub into a full user-facing reference (install/quick-start, configuration, command reference by group, exit-code contract for CI commands, MCP pointer) — restores `tests/docsSync.test.ts` to green.
- Fixed `docs/features.md` header (v0.90.11 / schema v21 / 778 tests), renamed `policy check` → `policy-check` throughout, added the 8 missing MCP tools to the catalog (`experts`, `doc_gap`, `contributor_profile`, `ownership`, `eval`, `triage`, `policy_check`, `workflow_run` — now 32 total).
- Updated `CLAUDE.md`: MCP tool count 24 → 32 with full table, architecture diagram now reflects `analysis/`, `temporal/`, and `clustering/` subdirectories, expanded the documented config-key list, and corrected the `first-seen`/`file-evolution`/`file-diff`/`diff` CLI reference sections to match `--help` output.

**Tests:** `npx vitest run tests/docsSync.test.ts` — all 9 tests pass (README now covers all `COMMAND_GROUPS` keys).

**Status:** ✅ complete.

### Phase 95 — Flag unification (review8 §8.6/§8.9) *(completed v0.92.0)*

**Goal:** Implement review8 §8.6 (output-flag unification) and §8.9 (date-flag standardization).

**Implemented scope:**

*§8.6 — `--out` unification:*
- Added the canonical `--out <spec>` option (`text|json[:file]|html[:file]|markdown[:file]`, repeatable) to every command that previously exposed only `--dump`/`--html`: `blame`, `dead-concepts`, `impact`, `clusters`, `cluster-diff`, `cluster-timeline`, `change-points`, `file-change-points`, `cluster-change-points`, `branch-summary`, `merge-audit`, `merge-preview`, `author`, `experts`, `debt`, `eval`. Most handlers already called `resolveOutputs({ out, dump, html })`; `experts` and `debt` were converted from ad-hoc dump/html handling to the shared `resolveOutputs`/`emitJsonSink` pattern, preserving legacy output byte-for-byte.
- Added `--out <spec>` (`text|json[:file]`) to the three `--format`-only commands in `register/analysis.ts` — `regression-gate`, `cross-repo-similarity`, `code-review` — with `--out` winning over `--format` when both are given.
- Annotated all legacy `--dump`, `--html`, and `--format` help strings with "(legacy: prefer --out ...)" where not already present. `ci-diff` keeps its pre-existing single-file `--out <file>` (predates the unified spec system) and is documented as an explicit exception.

*§8.9 — `--since`/`--until` standardization:*
- `gitsema search` now accepts `--since`/`--until` as documented aliases of `--after`/`--before` (explicit `--before`/`--after` win when both given).
- Swept `--since`/`--until` help strings across `register/all.ts` and `register/analysis.ts` to state accepted formats (YYYY-MM-DD / ISO 8601, plus "or git ref" only where the handler genuinely resolves refs, e.g. `cluster-timeline`, `change-points`, `file-change-points`, `cluster-change-points`).

*New test:* `tests/flagConsistency.test.ts` walks `buildProgram()`'s full command tree and asserts every `--dump`/`--html`/`--format` command also has `--out`, every command with both `--before` and `--after` also has `--since`/`--until`, and every `--top` option has the `-k` short flag — with documented exception lists for `ci-diff` (`--out` name collision) and seven commands whose `--top` is a differently-scoped per-group count (`clusters`, `cluster-diff`, `cluster-timeline`, `merge-preview`, `repos search`, `security-scan`, `watch run`).

**Tests:** `npx vitest run` — all tests pass, including the new `tests/flagConsistency.test.ts`.

**Follow-up:** The `ci-diff` exception noted above (§8.6) was eliminated — `ci-diff` now exposes the standard `--out <spec>` (repeatable, `text|json[:file]|html[:file]|markdown[:file]`) alongside its legacy `--format <fmt>` (now annotated "(legacy: prefer --out <fmt>)"), and `OUT_EXCEPTIONS` in `tests/flagConsistency.test.ts` is empty.

**Status:** ✅ complete.

### Phase 96 — LLM Narrator/Explainer/Guide via chattydeer *(completed v0.93.0)*

**Goal:** Add an optional LLM narration/explainer/guide layer on top of gitsema's existing git-history evidence, backed by `@jsilvanus/chattydeer` (pinned `^0.2.0`).

**Implemented scope:**

- New `src/core/narrator/` module: `types.ts` (provider interface, config types), `redact.ts` (secret/PII redaction applied before any LLM payload), `audit.ts` (records narrator calls), `chattydeerProvider.ts` (lazy-loaded `ChattydeerNarratorProvider`, safe-by-default — no network call unless a narrator model with `httpUrl` is configured), `resolveNarrator.ts` (DB-backed narrator/guide model config storage and active-selection in the new `settings` table), `narrator.ts` (`runNarrate`/`runExplain` — evidence-only by default).
- Schema v22: added `kind` + `params_json` columns to `embed_config` (narrator/guide configs share this table, distinguished by `kind`), and a new `settings` key-value table for active-config selection. Migration `src/core/db/migrations/022_narrator_config.ts`.
- New CLI commands: `gitsema narrate [options]`, `gitsema explain <topic> [options]` (both safe-by-default — return raw commit evidence unless `--narrate` is passed and a narrator model is configured), and `gitsema guide [question] [options]` (interactive LLM chat with gathered git context, falls back to narrator model). All registered in the `Analysis` command group.
- `gitsema models add/list/activate/remove --narrator|--guide` subcommands for managing LLM model configs (provider `chattydeer`, OpenAI-compatible `--http-url`).
- New MCP tools `narrate_repo` and `explain_issue_or_error` (`src/mcp/tools/narrator.ts`), registered in `src/mcp/server.ts`.
- New HTTP routes: `POST /api/v1/narrate`, `POST /api/v1/explain` (`src/server/routes/narrator.ts`), and `POST /api/v1/guide/chat` (`src/server/routes/guide.ts`).
- `narrate`/`explain` wired to the unified `--out <spec>` option (json/markdown/text sinks, file or stdout), with `--format md|text|json` retained as a legacy alias.
- New tests: `tests/narratorConfig.test.ts` (DB-backed config CRUD + active-selection through a real temp DB and the v22 migration), `tests/narratorRedact.test.ts` (redaction patterns), `tests/narratorSmoke.test.ts` (provider safe-by-default behavior — no network calls when disabled).

**Dependency note (resolved):** `@jsilvanus/chattydeer` has been bumped to `^0.4.5` (from `^0.2.0`), which ships the agentic tool-calling contract described in `docs/chattydeer_contract.md`: `createChatProvider(httpUrl, model, apiKey?, opts?)`, `createAgentSession({ systemPrompt?, messages? })`, and `runAgentLoop(session, { provider, tools, executeTool, maxRoundtrips, redactContent, ... })`. `@jsilvanus/embedeer` was bumped to `1.7.3` in the same pass (no regressions — full suite green before and after).

`gitsema guide` now runs a **real agentic loop** via `runAgentLoop` (maxRoundtrips: 5) against a `src/core/narrator/guideTools.ts` tool registry. Wired tools:

- `repo_stats`, `recent_commits` — reuse the existing context-gathering helpers from `guide.ts`.
- `narrate_repo`, `explain_topic` — reuse the evidence-only paths of `runNarrate`/`runExplain` from `narrator.ts` (never trigger a nested LLM call).
- `semantic_search` — reuses `vectorSearch` + `embedQuery` + `getTextProvider`; returns a structured `{ error: ... }` string (no throw, fast fail) when no `.gitsema` index exists or the embedding provider is unreachable.

**TODO (not yet wired — need index + heavier plumbing):** `file_evolution`, `concept_evolution`, `branch_summary` — listed as a TODO comment in `guideTools.ts`.

All tool results are compact JSON strings capped to ~4000 chars. `redactContent` (wired to `redactAll`) is applied to every outbound message. Interactive mode (`-i`) reuses one `createAgentSession`/`createChatProvider` pair across turns for true multi-turn conversation. The no-model safe-by-default path (placeholder + setup hint, no network) is preserved byte-for-byte. `POST /api/v1/guide/chat` now also returns optional `roundtrips`/`toolCallsUsed` fields (existing response fields unchanged).

Also fixed in this pass: `getActiveGuideConfig`/`resolveGuideConfig` previously called `getNarratorConfigById` (filters `kind = 'narrator'`) for guide-kind (`kind = 'guide'`) configs, so an active guide model config was never resolved — added `getGuideConfigById` (filters `kind = 'guide'`) and fixed the lookup chain.

**Tests:** `npx vitest run` — all 921 tests pass (907 existing + 14 new in `tests/guideAgentLoop.test.ts`, which mocks `@jsilvanus/chattydeer` with a fake provider/session/loop — no network).

**Status:** ✅ complete — agentic `guide` loop wired with 5 of 8 contract tools (the remaining 3 are TODO, see above).

### Phase 97 — Full-toolset guide, tool interpretation registry, skill generation, Ollama docs

**Goal:** Wire the full ~36-capability gitsema toolset into `gitsema guide`'s agentic loop
(closing the Phase 96 TODOs), introduce a single source of truth for how to interpret
each tool's output, generate the agent-facing skill from it, and verify/document Ollama
for embedding, narrator, and guide.

**Implemented scope:**

- **`src/core/narrator/guideTools.ts` restructured** into a single `GUIDE_TOOLS: Record<string, GuideToolEntry>`
  registry (`{ definition, category, needsIndex, run }`), deriving `GUIDE_TOOL_DEFINITIONS`
  and `executeTool` (map lookup, capped JSON, never throws) from it. Wires all ~36 capabilities
  — the same set exposed as MCP tools — across categories: repo, search, history, branch,
  ownership, quality, diff, clusters, workflow, admin (including the Phase 96 TODOs
  `file_evolution`, `concept_evolution`, `branch_summary`, plus `merge_audit`/`merge_preview`,
  `author`/`experts`/`ownership`/`contributor_profile`, `impact`/`dead_concepts`/`debt_score`/
  `doc_gap`/`security_scan`, `semantic_diff`/`semantic_blame`, `clusters`/`cluster_diff`/
  `cluster_timeline`, `triage`/`workflow_run`/`policy_check`/`eval`, and the admin `index` tool).
  Shared helpers: `requireIndex()`, `embedFor()`, `toCappedJson()`, `errorResult()`, arg coercers.
- **New `src/core/narrator/interpretations.ts`** — single source of truth for how to read
  each capability's output (`TOOL_INTERPRETATIONS: Record<string, ToolInterpretation>`,
  one entry per capability + `concept_lifecycle`). Exposes `buildNarratorSystemPrompt(name)`
  (shared persona + per-tool interpretation) and `buildGuideToolCatalog()` (compact
  per-tool catalog grouped by category).
- **`gitsema guide`** (`src/cli/commands/guide.ts`): system prompt rewritten to be built
  dynamically (role/goal, tool-use strategy, index-gating fallback, citation rules, plus
  the embedded `buildGuideToolCatalog()`); deduped `gatherContext()` to reuse
  `repoStatsData()`/`recentCommitsData()` from `guideTools.ts`.
- **Narrator prompts** (`src/core/narrator/narrator.ts` `runNarrate`/`runExplain`/
  `summariseBatch`, and all 11 `narrate*` functions in `src/core/llm/narrator.ts` via
  `callLlm`'s new optional `systemPrompt` parameter) now use
  `buildNarratorSystemPrompt('<tool>')` instead of hardcoded persona strings.
- **Skill generation**: `scripts/gen-skill.mjs` (`pnpm gen:skill`) regenerates the
  "Interpreting gitsema tool results" section of `skill/gitsema-ai-assistant.md` (and its
  `.github/skills/gitsema.md` mirror) from `TOOL_INTERPRETATIONS`, between
  `<!-- GENERATED:INTERPRETATIONS START/END -->` markers. Added a hand-written
  "Using `gitsema guide`" section and an "Ollama for narrator / guide / explain" section.
  `"skill"` added to `package.json` `files` so the skill ships with the npm package.
- **Ollama verification (documented, no new flags):** confirmed both `src/core/llm/narrator.ts`
  (`new URL('/v1/chat/completions', httpUrl)`) and `@jsilvanus/chattydeer`'s `createChatProvider`
  (`base + '/v1/chat/completions'`) resolve correctly when `--http-url` is the bare
  `http://localhost:11434` (no trailing `/v1`) — a trailing `/v1` breaks chattydeer
  (`/v1/v1/chat/completions`) though it's harmless for the narrator's `URL`-based resolution.
  Documented this caveat in README and the skill's Ollama section, with the
  `gitsema models add ol-guide --guide --http-url http://localhost:11434 --activate` recipe.
- **Tests**: `tests/guideAgentLoop.test.ts` updated for the new registry (tool name set
  derived from `GUIDE_TOOLS`, still validates JSON-schema shapes and required params);
  `tests/narrator.test.ts` updated for the new system-message-first `messages` array;
  `tests/docsSync.test.ts` gained TOOL_INTERPRETATIONS coverage (every `GUIDE_TOOLS` entry
  has an interpretation) and skill-generation drift checks (generated block + `.github`
  mirror match committed files).

**Tests:** `npx vitest run` — all 921 tests pass.

**Backlog (deferred from this phase):**
- Per-command `--narrate` flag using `interpretations.ts` entries (beyond `narrate`/`explain`/result-narrators).
- `gitsema models add --provider ollama` shortcut and a custom Ollama embedding base-URL option.
- Skill guidance on fine-tuning indexing (chunkers/models/extension filters) per project type.

**Status:** ✅ complete.

### Phase 98 — CLI-based AI tool backends for narrator/guide

**Goal:** Let `gitsema narrate`/`explain`/`guide` use a locally-installed, already-authenticated
CLI AI coding agent (Claude Code, Codex CLI, GitHub Copilot CLI, etc.) as the LLM backend,
as an alternative to the existing HTTP/chattydeer path.

**Implemented scope:**

- **`src/core/narrator/types.ts`**: `NarratorModelParams` is now a discriminated union of
  `HttpNarratorParams` (existing `httpUrl`/`apiKey`/`maxTokens`/`temperature`) and
  `CliNarratorParams` (`cliCommand`, `cliArgs?`, `useMcp?`, `timeoutMs?`, `maxTokens?`,
  `temperature?`), with an `isCliParams()` type guard. `params_json` storage is unchanged
  (no schema migration needed).
- **New `src/core/narrator/cliAdapters.ts`**: per-tool argv builders / output parsers
  behind a small `CliAdapter` interface — `claude` (full support: `-p`/`--output-format
  json`, `--mcp-config`/`--allowedTools mcp__gitsema__*` when `useMcp`, `--resume <id>`
  for session continuity, JSON `{result, session_id}` parsing), `codex` (`codex exec
  "<prompt>"`, best-effort/experimental — no MCP/session support), `copilot`/`gh`
  (`copilot explain "<prompt>"`, one-shot only, no MCP/session support), and a generic
  fallback (`<cliCommand> [cliArgs...] "<prompt>"`, raw stdout). `getCliAdapter()` resolves
  by basename so full paths to the executable work too.
- **New `src/core/narrator/cliProvider.ts`**: `CliNarratorProvider implements
  NarratorProvider`, mirroring `ChattydeerNarratorProvider`'s safe-by-default /
  redaction / audit pattern. Redacts system+user prompts, combines them into one prompt,
  spawns the configured CLI tool via `execFile` (`runCli()`, exported, default 60s
  timeout), and never throws — spawn errors / non-zero exit return a graceful
  `(narrator error: ...)` response. `tokensUsed` is always `0`.
- **New `src/core/narrator/cliMcpConfig.ts`**: `writeGitsemaMcpConfig(repoRoot)` writes a
  temporary MCP config file exposing gitsema's own `tools mcp` server (re-using the
  running gitsema binary and cwd), for guide's `--use-mcp` mode.
- **`src/core/narrator/resolveNarrator.ts`**: new `createNarratorProviderFor(config)`
  factory dispatches on `config.provider`/`config.params` shape — `'cli'` + CLI params →
  `CliNarratorProvider`, HTTP params with `httpUrl` → `ChattydeerNarratorProvider`,
  otherwise the disabled placeholder. `resolveNarratorProvider()`/`resolveGuideProvider()`
  now return the `NarratorProvider` interface (widened from
  `ChattydeerNarratorProvider`) and delegate to this factory.
- **`gitsema models add <name> --narrator|--guide`** (`src/cli/commands/models.ts`,
  `src/cli/register/setup.ts`): new `--provider cli --cli-command <tool> [--cli-args
  "<args>"] [--use-mcp]` flags save `CliNarratorParams` with `provider = 'cli'`;
  `--http-url` remains the default path (`provider = 'chattydeer'`). `models list` shows
  `cli: <cliCommand> [(--use-mcp)]` instead of an HTTP URL for CLI-backed configs.
- **`gitsema guide`** (`src/cli/commands/guide.ts`): `GuideSession` is now a union of
  `ChattydeerGuideSession` (existing `runAgentLoop` path, extracted into
  `runChattydeerGuideTurn()`) and `CliGuideSession` (`{ config, mcpConfigPath?,
  sessionId? }`). For `provider === 'cli'`, `createGuideSession()` writes the gitsema MCP
  config (if `useMcp`) and `runCliGuideTurn()` combines the system+user prompt, calls the
  adapter's `buildGuideArgs()` (passing `mcpConfigPath`/`resumeSessionId`), spawns via
  `runCli()`, and stores the returned `session_id` on the session for the next turn
  (`-i/--interactive`) — replacing chattydeer's `agentSession.append/history` for CLI
  providers. gitsema does **not** proxy tool calls for CLI providers; the CLI tool's own
  agent loop talks to `gitsema tools mcp` directly via MCP.
- **Tests**: `tests/cliAdapters.test.ts` (pure argv/parseOutput unit tests per adapter),
  `tests/cliNarratorProvider.test.ts` (mocked `node:child_process`: disabled placeholder,
  argv construction, redaction before spawn, graceful error on spawn failure, generic
  adapter fallback), `tests/narratorCliModels.test.ts` (`models add --provider cli`
  round-trips through `embed_config`/`params_json`, `models list` display,
  `--cli-command` validation), and new cases in `tests/guideAgentLoop.test.ts` (CLI guide
  turn spawns the configured tool and skips chattydeer entirely; `--resume <id>` passed
  on the second turn of an interactive session).

**Tests:** `pnpm build && pnpm test` — all 953 tests pass.

**Status:** ✅ complete.

### Phase 99 — `--provider ollama` for narrator/guide + Ollama model discovery

**Goal:** Let `gitsema models add <name> --narrator|--guide --provider ollama` configure
a local Ollama model as the LLM backend out of the box, and let `gitsema models add`
(embedding, narrator, or guide) list locally-available Ollama models when no `<name>`
is given.

**Implemented scope:**

- **`src/core/narrator/types.ts`**: `HttpNarratorParams` gains an optional `model` field —
  the actual model id sent to the chat-completions API, defaulting to the config's local
  name when unset (mirrors the embedding `globalName` concept).
- **`src/core/narrator/chattydeerProvider.ts`**: fixed a long-standing bug where
  `buildHttpGenerateFn` hardcoded `model: 'default'` in the `/v1/chat/completions`
  request body — this broke Ollama (and any OpenAI-compatible API that validates the
  `model` field). Now sends `params.model ?? modelName`.
- **`src/cli/lib/provider.ts`**: new `listOllamaModels(url, timeoutMs)` queries
  `/api/tags` and returns the list of locally pulled model names (`[]` on any error,
  mirroring `probeOllama`).
- **`gitsema models add [name] --narrator|--guide --provider ollama`**
  (`src/cli/commands/models.ts`): new provider branch — defaults `--http-url` to
  `http://localhost:11434`, stores `provider = 'ollama'` (still resolved by
  `createNarratorProviderFor` via the existing `ChattydeerNarratorProvider`/httpUrl
  path), supports `--global-name <tag>` to set `params.model` when the local alias
  differs from the Ollama tag, and warns (non-fatal) if Ollama is unreachable.
- **`gitsema models add [name]`** (embedding, narrator, guide): `<name>` is now optional
  (`add [name]`). When omitted and the (effective) provider is `ollama`, gitsema calls
  `listOllamaModels()` and prints the available models with a usage hint instead of
  failing with "model name is required"; exits with an error if Ollama has no models /
  is unreachable. Non-ollama providers still require an explicit name.
- **`src/cli/register/setup.ts`**: `add <name>` → `add [name]`, updated `--provider`/
  `--http-url`/`--global-name` help text and examples for the ollama narrator/guide path.
- **Tests**: `tests/cliLib.test.ts` (`listOllamaModels`), `tests/narratorCliModels.test.ts`
  (`--provider ollama` narrator/guide configs, `--global-name` → `params.model`, no-name
  discovery), `tests/modelsAddOllamaDiscovery.test.ts` (embedding `models add` discovery),
  `tests/chattydeerProvider.test.ts` (`model` field sent to `/v1/chat/completions`).

**Tests:** `pnpm build && pnpm test` — all 967 tests pass.

**Status:** ✅ complete.

## Long-Term Investments

| Feature | Complexity | Notes |
|---------|:----------:|-------|
| Plugin API for custom analysers | High | Allow third-party modules to register their own search/analysis commands |

> **Note:** the "pgvector migration path for >500K blobs" item formerly listed
> here was implemented by Phases 101-103 (`storage.backend=postgres\|qdrant`,
> see [Phases 101-103](#phases-101–103-—-pluggable-storage-backends-index-scoping)).
> SQLite remains the default for new projects.

**Scale notes (updated for v0.81.0):**

- **Search memory:** auto early-cut (Phase 82) now guards the default search path — reservoir sampling kicks in at 50 K candidates without any flags. ANN path (`gitsema index build-vss`) eliminates the candidate-load entirely for large indexes.
- **Indexing time:** commit-message embedding is now parallelised (Phase 83). The read/embed/store pipeline (Phase 69) + parallel commit embedding together keep both phases off the critical path. The remaining serial bottleneck is commit-graph walking itself (git rev-list) which is I/O-bound.
- **Chunk/symbol candidate expansion:** when `--chunks` or `--vss` is combined with a large index the candidate pool grows 3–10× before scoring. Monitor RSS when indexing large monorepos with `--chunker function`.

## Non-goals for now (revisited later)

| Feature | Reasoning | 
|---------|:----------:|-------|
| Python model server (GPU Docker) | We already have Node.js embedeer and if we want Docker+python, we can use ollama. |

---

### Phase 100 — Persistent, registry-backed server-side repo storage

**Goal:** Make `gitsema tools serve`'s `POST /api/v1/remote/index` persist cloned
repos and their indexes by default (instead of cloning to a temp dir and discarding
them), so the server supports three deployments without code forks: a single dev
running gitsema + repo storage on one box, a team sharing one clone+index per repo,
and an enterprise isolating repos/indexes per team via existing per-repo token scoping.

**Implemented scope:**

- **Schema v22 → v23** (`src/core/db/sqlite.ts`, `src/core/db/schema.ts`,
  `src/core/db/migrations/023_repos_persistent_storage.ts`): added `normalized_url`
  (unique index), `clone_path`, `last_indexed_at`, `ephemeral` columns to `repos`.
- **`src/core/indexing/repoRegistry.ts`**: new `GITSEMA_DATA_DIR`-based persistent
  storage layout (`repos/<repoId>/{repo/, index.db}`, `registry.db`):
  `getDataDir`, `getRepoDir`/`getRepoClonePath`/`getRepoDbPath`, `getRegistrySession`,
  `normalizeRepoUrl` (strips credentials/`.git`/trailing slashes, lowercases host),
  `deriveRepoId` (sha256-based 16-hex-char id, stable per normalized URL),
  `findRepoByNormalizedUrl`, `registerPersistedRepo` (upsert), `touchLastIndexed`,
  `removeRepo`, and a per-repo mutex (`withRepoLock`) serializing concurrent
  clone/fetch/index operations on the same repo.
- **`src/core/db/sqlite.ts`**: new `getOrOpenSessionAtPath(dbPath)` — cached,
  path-keyed `DbSession` factory (used for both `registry.db` and per-repo
  `index.db` files).
- **`src/core/git/cloneRepo.ts`**: `obtainClone({ mode: 'persistent', targetDir })`
  reuses an existing valid clone via `git fetch` (re-cloning if missing/corrupted)
  instead of always cloning to a temp dir; `cloneToPath`/`isValidGitDir` helpers
  shared with the ephemeral path. SSH agent forwarding: when no explicit
  `credentials.sshKey`/`token` is supplied and `SSH_AUTH_SOCK` is set, it (and a safe
  `GIT_SSH_COMMAND`, no `-i`) are forwarded to `git` so the server can re-index
  private repos on a schedule without per-request keys.
- **`src/server/routes/remote.ts`**: `POST /api/v1/remote/index` request schema gains
  `persist` (default `true`) and `repoId`. Default flow: normalize `repoUrl` →
  look up/derive `repoId` → `withRepoLock(repoId, ...)` → persistent clone/fetch →
  incremental `runIndex` against `$GITSEMA_DATA_DIR/repos/<repoId>/index.db` →
  `registerPersistedRepo` + `touchLastIndexed` on success. `404` for unknown explicit
  `repoId`, `409` for a `repoId`/`repoUrl` mismatch, `403` for scoped-token misuse
  (wrong repo or attempting to register a new one). `persist: false` preserves the
  legacy ephemeral (`GITSEMA_CLONE_KEEP`/`GITSEMA_CLONE_DIR`, `dbLabel`) behavior.
  Failed re-index of a persisted repo never deregisters it or deletes its clone.
- **`src/server/middleware/repoSession.ts`** (new) + wiring in `src/server/app.ts`:
  resolves an optional `repoId` (body for `POST` / query string for `GET`, or the
  scope of a per-repo auth token) to a persisted repo's `index.db` and makes it the
  active `DbSession` for the request via `withDbSession`; `403` on scoped-token
  mismatch, `404` for unknown `repoId`. Applied to search, evolution, analysis,
  watch, projections, narrator, and guide routers. With no `repoId`, behavior is
  unchanged (default cwd `.gitsema/index.db`).
- **CLI** (`src/cli/commands/repos.ts`): `gitsema repos list-persisted` and
  `gitsema repos remove <repoId> [--purge]` manage the `GITSEMA_DATA_DIR` registry.
- **Tests**: `tests/repoRegistry.test.ts` (normalize/derive/register/find/lock),
  `tests/repoSessionMiddleware.test.ts` (repoId resolution, 403/404 paths),
  `tests/remoteIndexPersistence.test.ts` (repoId derivation/reuse, 404/409/403 on
  `/api/v1/remote/index`, `persist: false`).

**Deviations from the original plan:**
- Persistent re-fetch is `git fetch` only (no checkout/reset) — gitsema's indexer
  reads via `git rev-list`/`git cat-file` at the object level, so a working-tree
  checkout isn't needed.
- `runIndex` already resolves `since` to the last indexed commit when omitted, so no
  extra "last indexed ref" bookkeeping was needed beyond `last_indexed_at` (used for
  `repos list-persisted` display).

**Tests:** `pnpm build && pnpm test` — all 990 tests pass.

**Status:** ✅ complete.

---

### Phases 101–103 — Pluggable storage backends & index scoping

**Goal:** Let users run gitsema against alternative storage backends (Postgres +
pgvector, Qdrant) instead of only local SQLite, with a clear index-scoping model
(project / user / named) and local-or-remote locations.

**Design:** Full design and rationale (axes, abstraction-option trade-offs,
async strategy, table→store mapping, BM25 per backend, consistency/portability)
live in [`docs/storage-backends-plan.md`](storage-backends-plan.md). Chosen
direction: split into a **`MetadataStore` + `VectorStore` + `FtsStore`** seam
(relational metadata always present; vector store and keyword/BM25 store each
independently pluggable, `FtsStore` optional), migrated behind an **async**
interface.

**Phases:**
- **Phase 101 — Async storage seam (foundation):** introduce
  `src/core/storage/` async interfaces (`MetadataStore`/`VectorStore`/`FtsStore`)
  + SQLite adapter; make the vector read path async; add `storage.*` config and
  the scope model. No new backend, no behavior change.

  **Implemented (foundation slice):**
  - `src/core/storage/types.ts` — the three async store interfaces +
    `StorageProfile` (`backend`, `scope`, `location`).
  - `src/core/storage/sqlite/profile.ts` — `SqliteStorageProfile` implementing
    all three interfaces by delegating to existing code (`vectorSearch`,
    `searchCommits`, deduper, `storeFtsContent`/`getBlobContent`, a BM25 FTS5
    query). Stateless: resolves `getActiveSession()` per call, so it cooperates
    with `withDbSession()`.
  - `src/core/storage/resolveProfile.ts` — `resolveStorageProfile()`,
    `resolveSqliteDbPath()` (project/user/named → path), and
    `withStorageProfile()`. `postgres`/`qdrant` throw a clear
    "planned for Phase 102/103" error.
  - `storage.*` config keys + `GITSEMA_STORAGE_*` env mappings in
    `configManager.ts`.
  - `tests/storageProfile.test.ts` — 16 conformance/resolution tests.

  **Read-path async migration (done):** `vectorSearch`/`hybridSearch`/
  `searchCommits` are now `async`, with `await` threaded through ~37 caller files
  (CLI, MCP, server, core search, tests). Pure mechanical change; build clean,
  1006 tests green.

  **Deferred to Phase 102:** (1) production call sites still invoke the async
  search functions *directly* rather than via `profile.vectors.*`/`profile.fts.*`
  — routing them through the profile is what makes the backend actually
  swappable; (2) the indexing **write-path** migration (`blobStore`/`indexer`/
  `deduper`) with its cross-store transaction boundary. ✅ Phase 101 complete.
- **Phase 102 — Postgres metadata + pgvector:** route consumers through
  `profile.vectors.*`/`profile.fts.*`; migrate the indexing write path (both
  carried from 101); Postgres `MetadataStore` + `FtsStore` (`tsvector` BM25) +
  pgvector `VectorStore`.

  **Implemented:**
  - **Read-path routing (carried from 101):** rather than editing each of the
    ~30 read-path call sites individually, `vectorSearch`/`hybridSearch`/
    `searchCommits` now dispatch on `getCachedStorageProfile().backend` at
    entry: for `sqlite` the existing function body *is* the implementation
    (and `SqliteVectorStore.search`/`.searchCommits` delegate back into it, so
    there's no recursion); for `postgres`/`qdrant` the call is forwarded to
    `profile.vectors.*`/`profile.fts.*`. This makes every caller backend-agnostic
    without a 30-file mechanical edit, at the cost of the dispatch living inside
    these three functions instead of at each call site — the outcome the plan's
    §1 bullet asks for ("backend actually swappable"), via a different
    mechanism than literal call-site edits.
  - **Write-path interface (carried from 101):** `src/core/storage/types.ts`
    gained `VectorKind`/`VectorRecord`, write methods on `MetadataStore`
    (`putBlob`, `addPath`, `putCommit`, `linkBlobCommits`, `setBlobBranches`,
    `markCommitIndexed`, `getLastIndexedCommit`), `VectorStore.upsert`/`.delete`,
    and `StorageProfile.writeFileBlob`/`.writeBlobRecord` as the cross-store
    atomic write boundary. Implemented for both SQLite (delegating to existing
    `blobStore.ts` functions) and Postgres (single-transaction `BEGIN`/`COMMIT`).
    **Deviation / carried to Phase 103:** `indexer.ts`/`blobStore.ts`/
    `deduper.ts` themselves still call the synchronous SQLite-only functions
    directly — they have not been rewired to call these new seam methods. The
    write-path *interface* is complete and conformance-tested (SQLite +
    Postgres), but a Postgres profile is not yet *writable* via `gitsema index`.
    Rewiring the indexer is bundled into Phase 103 alongside the Qdrant
    write path, since both need the same async call-site changes.
  - **Postgres `MetadataStore` + `FtsStore`**
    (`src/core/storage/postgres/{metadataStore,ftsStore}.ts`): plain-SQL schema
    (`src/core/storage/postgres/migrations.ts`, a separate idempotent migration
    track from `sqlite.ts`). `FtsStore` defaults to `tsvector` + `ts_rank_cd`
    (`storage.fts.backend=tsvector`, the default for postgres); ParadeDB
    `pg_search` BM25 is opt-in (`storage.fts.backend=pg_search`, requires the
    `pg_search` extension — implemented but not exercised in CI). `Bm25Hit.score`
    is negated (`-rank` / `-bm25_score`) so `hybridSearch`'s normalization is
    identical across backends. `ts_rank_cd` is an approximation of BM25, not a
    drop-in match for SQLite FTS5 — see docs/storage-backends-plan.md §11.
  - **pgvector `VectorStore`** (`src/core/storage/postgres/vectorStore.ts`):
    fetches a wide ANN-ordered candidate pool via `<=>` (cosine distance) per
    kind (file/chunk/symbol/module/commit), then re-ranks with the same JS
    three-signal logic (`pathRelevanceScore` + `computeRecencyScores`) as the
    SQLite adapter — the `--vss` trick, generalized.
    **Deviation:** embedding columns are unconstrained `vector` (no fixed
    dimension), so `<=>` does an *exact* kNN scan rather than HNSW-approximate;
    per-model HNSW indexes (which require a fixed dimension) are a documented
    follow-up. Not yet supported on this backend: `allowedHashes`, `useVss`,
    `earlyCut`, result caching (`noCache`/`queryText`).
  - **`resolveStorageProfile()`** now resolves `storage.backend=postgres` from
    `storage.metadata.url` (a `postgres://...` connection string; throws if
    missing/non-URL) and validates `storage.fts.backend` (`tsvector` |
    `pg_search` | `none`). `withStorageProfile()` supports postgres profiles
    (no-op activation — the profile holds its own connection pool).
  - **Infra:** `docker-compose.postgres.yml` (pgvector/pgvector image, dev/test);
    `.github/workflows/ci.yml` gained a `postgres-storage-tests` job (Linux-only
    pgvector service container) running `tests/postgresStorageProfile.test.ts`,
    gated on `GITSEMA_TEST_POSTGRES_URL` (also skips cleanly when unset, e.g.
    the main matrix job).
  - **Tests:** `tests/storageProfile.test.ts` gained write-path conformance
    tests (SQLite); `tests/postgresStorageProfile.test.ts` is a parallel
    conformance + parity suite run against real Postgres+pgvector (verified
    locally against postgres 16 + pgvector 0.6 — 1029/1029 tests green).

- **Phase 103 — Qdrant + portability/ops:** Qdrant `VectorStore` with a
  relational companion store; rewire `indexer.ts`/`blobStore.ts`/`deduper.ts`
  to the write-path seam (Postgres *and* Qdrant — carried from 102);
  `gitsema storage migrate`, doctor orphan checks, status backend reporting.

  **Implemented:**
  - **Indexer write-path rewiring (carried from 102):** `indexer.ts` now writes
    blobs/embeddings/paths/FTS via `profile.writeFileBlob`/`.writeBlobRecord`,
    commit/branch links via `profile.metadata.linkBlobCommits`/
    `.setBlobBranches`/`.markCommitIndexed`/`.getLastIndexedCommit`, and
    chunk/symbol/commit-message embeddings via `profile.vectors.upsert`,
    instead of calling the synchronous SQLite-only `blobStore.ts` functions
    directly — `gitsema index` is now backend-agnostic for postgres and qdrant.
    **Deviations:** (1) module (directory centroid) embeddings remain
    SQLite-only (`moduleEmbeddingsSupported = profile.backend === 'sqlite'`) —
    their running-mean update needs a read-modify-write that isn't part of the
    `VectorStore` seam; (2) `gitsema index --file <path>` (`indexFileCommand` in
    `src/cli/commands/index.ts`) still calls `storeBlob`/`storeBlobRecord`
    directly and so only writes to the SQLite backend regardless of
    `storage.backend` — fixing this is a documented follow-up.
  - **Qdrant `VectorStore` + `StorageProfile`**
    (`src/core/storage/qdrant/{connection,vectorStore,profile}.ts`, using
    `@qdrant/js-client-rest`): one collection per `(kind, model, dimensions)`
    tuple (`gitsema_<kind>_<model>_<dims>`), created lazily on first `upsert`.
    Deterministic sha1-derived UUID point ids keyed on the natural id (plus
    line range for chunk/symbol). `search()`/`searchCommits()` fetch a wide
    ANN candidate pool then re-rank in JS with `pathRelevanceScore` +
    `computeRecencyScores`, mirroring `PgVectorStore`. Reuses Phase 102's
    `PostgresMetadataStore`/`PostgresFtsStore` as the relational companion for
    paths/commits/branches/FTS (`storage.metadata.url`, a `postgres://...`
    string, is required alongside `storage.vectors.url`).
    **Deviation:** `first_seen`/`last_seen` are *not* denormalized into the
    Qdrant payload (despite §6.5) — `search()`/`searchCommits()` instead join
    through the Postgres companion's `blob_commits`/`commits` tables, exactly
    like `PgVectorStore`, to avoid plumbing a new field through `VectorRecord`
    and the indexer. Cross-store writes (Postgres metadata + Qdrant vectors)
    are not atomic — a partial write self-heals on the next incremental
    `index` run via the existing dedup check (per §8).
  - **`resolveStorageProfile()`** now resolves `storage.backend=qdrant` from
    `storage.vectors.url` (Qdrant `http(s)://` URL, required) +
    `storage.metadata.url` (postgres companion, required) +
    `storage.vectors.apiKey` (optional) + `storage.fts.backend`.
    `withStorageProfile()` no-ops for qdrant (own client/pool).
  - **`gitsema storage migrate --to <backend> [...]`**
    (`src/core/storage/migrate.ts`, `src/cli/commands/storageMigrate.ts`):
    copies an index between backends — reads every table from the *source*
    sqlite database directly (`better-sqlite3`) and re-`upsert`s/inserts into
    the destination via `profile.metadata`/`profile.vectors`/`profile.fts`.
    All destination writes use content-addressed/idempotent paths
    (`ON CONFLICT DO NOTHING`, deterministic point ids), so a migration is
    safe to re-run/resume after an interruption.
    **Deviation:** only `sqlite` sources are supported (`--to` selects
    sqlite/postgres/qdrant destinations) — migrating *from* postgres/qdrant
    would need new "list all rows" methods on `MetadataStore`/`VectorStore`
    that don't exist yet; documented as a follow-up rather than blocking this
    phase, since sqlite → {postgres, qdrant} is the primary "move my existing
    index" use case.
  - **Doctor / status backend reporting:** `MetadataStore.getStats()` (row
    counts: blobs, paths, commits, indexed commits, branches, last indexed
    commit) is implemented for SQLite and Postgres (and therefore Qdrant, via
    the Postgres companion). `gitsema doctor` and `gitsema status` detect
    non-sqlite profiles and report backend/scope/location plus these counts
    via the new `runStorageDoctor()` (`src/core/storage/doctor.ts`), which also
    cross-checks the vector store's file-embedding count against the metadata
    store's blob count and flags disabled FTS.
    **Deviation:** the deep sqlite-only checks in `gitsema doctor`
    (`PRAGMA integrity_check`, schema-version check, FTS5-backfill count, the
    `--extended` model-reachability/freshness/latency checks) remain
    sqlite-specific — there is no equivalent single-file integrity check for
    postgres/qdrant.
  - **Infra:** `docker-compose.qdrant.yml` (qdrant/qdrant image, dev/test);
    `.github/workflows/ci.yml` gained a `qdrant-storage-tests` job (postgres +
    qdrant service containers) running `tests/qdrantStorageProfile.test.ts`,
    gated on `GITSEMA_TEST_QDRANT_URL`/`GITSEMA_TEST_POSTGRES_URL`.
  - **Tests:** `tests/qdrantStorageProfile.test.ts` mirrors
    `tests/postgresStorageProfile.test.ts` (adapter conformance +
    `resolveStorageProfile`/`withStorageProfile`); `tests/storageProfile.test.ts`
    gained `getStats`/`runStorageDoctor` coverage and replaced the old
    "qdrant throws" test with the new validation/resolution tests.

**Status:** Phase 101 ✅ complete (seam + SQLite adapter + config + read-path
async migration); Phase 102 ✅ complete (read-path dispatch, write-path
interface + SQLite/Postgres implementations, pgvector `VectorStore`, Postgres
`MetadataStore`/`FtsStore`, CI Postgres service); Phase 103 ✅ complete (indexer
write-path rewiring, Qdrant `VectorStore`/`StorageProfile`, `gitsema storage
migrate`, doctor/status cross-store reporting, CI Qdrant service) — see
deviations above.

---

### Phase 104 — Full-toolset guide coverage, per-command `--narrate`, and a guided `gitsema setup` wizard

**Goal:** Close the remaining gaps between the CLI's ~50 analysis/workflow
commands and the `gitsema guide`/`narrate`/`explain` LLM layer (Phases 96-99),
and give new users (and new backends from Phases 101-103) a single guided
setup path. Three independently-shippable slices:

**Slice 1 — Wire the remaining read-path analysis commands into `gitsema guide`.**
`src/core/narrator/guideTools.ts` currently exposes 37 tools in `GUIDE_TOOLS`.
The following read-only analysis commands have no `GUIDE_TOOLS` entry and
should get one (reusing the same `core` functions the CLI commands call —
do not duplicate logic):
- `bisect` (`semanticBisect` / `runSemanticBisect`-style core fn used by
  `semanticBisectCommand`)
- `refactor-candidates` (`findRefactorCandidates`)
- `cherry-pick-suggest` (`suggestCherryPicks`)
- `heatmap` (`computeHeatmap`)
- `map` (`computeSemanticMap` / whatever backs `mapCommand`)
- `file-diff` (`computeFileDiff`/`computeSemanticDiff`-for-a-single-file, used
  by `diffCommand`)
- `diff <ref1> <ref2> <query>` (conceptual diff across two refs — name it
  `ref_diff` or `concept_diff` in `GUIDE_TOOLS` to avoid clashing with the
  existing `semantic_diff` tool, used by `remoteIndexCommand`'s sibling
  — verify the actual handler, `src/cli/register/all.ts` around `'diff <ref1> <ref2> <query>'`)
- `lifecycle <query>` (`computeConceptLifecycle`, used by
  `conceptLifecycleCommand`)
- `cluster-change-points` (`computeClusterChangePoints`)
- `cross-repo-similarity <query>` (used by `crossRepoSimilarityCommand` in
  `src/cli/register/analysis.ts`)
- `pr-report` (used by `prReportCommand`)

For each: add a `GuideToolEntry` (category, `needsIndex`, JSON-schema
`definition`, `run` handler returning a size-capped JSON-safe object, mirroring
the existing entries' style — wrap in try/catch, never throw), add a matching
entry to `src/core/narrator/interpretations.ts` (`TOOL_INTERPRETATIONS`)
describing the result shape/significant fields/thresholds, then run
`pnpm gen:skill` to regenerate `skill/gitsema-ai-assistant.md` and its
`.github/skills/gitsema.md` mirror. `tests/docsSync.test.ts` enforces that every
`GUIDE_TOOLS` entry has an interpretation and that the generated skill matches
committed files — keep it green. Extend `tests/guideAgentLoop.test.ts` with
coverage for the new tool names (tool-name-set assertions + at least one
executed-tool-result test per new tool, following the existing pattern).
Admin/infra commands (`config`, `models`, `doctor`, `status`, `storage`,
`repos`, `tools mcp/lsp/serve`, `gc`/`vacuum`/`check`, `export`/`import`,
`backfill-fts`, `build-vss`, `update-modules`) remain intentionally excluded
from `GUIDE_TOOLS`, per existing precedent — do not wire these.

**Slice 2 — Generic per-command `--narrate` support.**
Phase 97's backlog noted "Per-command `--narrate` flag using
`interpretations.ts` entries (beyond `narrate`/`explain`/result-narrators)" as
deferred. 10 commands already have a bespoke `--narrate` flag (`search`,
`evolution`, `file-evolution`, `lifecycle`, `file-diff`, `clusters`,
`cluster-diff`, `cluster-timeline`, `change-points`, `file-change-points`),
each calling its own `narrate*` function in `src/core/llm/narrator.ts`. Add a
**generic** narration path so the remaining commands can opt in without a
bespoke `narrate*` function per command:
- New helper in `src/core/llm/narrator.ts`, e.g.
  `narrateToolResult(toolKey: string, result: unknown, opts?: { focus?: string })`
  — looks up `TOOL_INTERPRETATIONS[toolKey]` (added/extended in Slice 1) for
  the "how to read this" guidance, builds a system prompt from
  `buildNarratorSystemPrompt(name)` + the interpretation text, sends the
  (redacted, size-capped) JSON result as the user payload to the active
  narrator model, and returns a short prose summary. Must remain
  safe-by-default: no network call unless `--narrate` is passed **and** a
  narrator model is configured (mirror the existing guard in
  `runNarrate`/`runExplain` and the bespoke `narrate*` functions — same
  "no narrator configured" placeholder message).
- Add `--narrate` to a first batch of commands that lack it and have a
  `TOOL_INTERPRETATIONS` entry already or added in Slice 1: `first-seen`,
  `branch-summary`, `merge-audit`, `merge-preview`, `dead-concepts`,
  `debt-score`, `doc-gap`, `security-scan`, `blame`/`semantic-blame`, `triage`,
  `impact`, `ownership`, `experts`, `author`, `contributor-profile`, `bisect`,
  `refactor-candidates`, `cherry-pick-suggest`, `heatmap`. Each wires
  `--narrate` → `narrateToolResult('<tool_key>', result)` → print the summary
  after the normal text/JSON output (same placement convention as the existing
  bespoke `--narrate` flags).
- `workflow run` and `policy-check`/`ci-diff`/`regression-gate` are
  out of scope for `--narrate` (workflow already composes narrated sections
  where relevant; policy gates are machine-consumed and must stay
  deterministic).
- Add unit tests for `narrateToolResult` (mocked chattydeer provider, no
  network) and at least one integration-style test per newly-wired command
  verifying `--narrate` without a configured model prints the existing
  safe placeholder (no crash, no network).

**Slice 3 — Guided `gitsema setup` wizard.**
`gitsema quickstart` (`src/cli/commands/quickstart.ts`) already walks a new
user through repo detection → provider/model selection → config write →
initial index, but predates Phases 101-103 and only ever configures the
default SQLite backend. Add a guided storage-backend step:
- Insert a new step into the wizard (between provider/model selection and
  config write) that asks: "Storage backend: sqlite (default) / postgres /
  qdrant?" — for `postgres`, prompt for `storage.metadata.url` and optional
  `storage.fts.backend`; for `qdrant`, prompt for `storage.vectors.url`,
  `storage.metadata.url`, and optional `storage.vectors.apiKey`. Persist via
  `setConfigValue('storage.backend', ...)` etc. (extend
  `src/core/config/configManager.ts`'s supported-keys list if any
  `storage.*` keys aren't already settable via `gitsema config set`).
  Validate with `resolveStorageProfile()`/`getCachedStorageProfile()` before
  writing, surfacing connection errors before the wizard proceeds to indexing.
- Add `gitsema setup` as the primary discoverable name for this wizard
  (`gitsema quickstart` remains as a backward-compat alias, same as the
  `tools mcp`/`mcp` precedent) — register both in
  `src/cli/register/analysis.ts`, both calling the same `quickstartCommand`
  (renaming the exported function is optional; an alias registration is
  sufficient).
- Optional final step (skippable): offer to configure a narrator/guide model
  via the existing `gitsema models add <name> --narrator|--guide --provider
  ollama` flow (Phase 99) if Ollama is detected, so `gitsema narrate`/`guide`
  work out of the box too.
- Update README.md's quick-start section and `docs/features.md` to mention
  `gitsema setup`/`gitsema quickstart` covers backend selection; add a
  changeset.

**Out of scope / explicit non-goals for Phase 104:**
- No new storage backends or `StorageStats`/`doctor` changes (Phases 101-103
  are complete).
- No changes to `GUIDE_TOOLS`/`interpretations.ts` for admin/infra commands.
- No change to the safe-by-default behavior of `narrate`/`explain`/`guide`
  (no network without an explicit `--narrate`/configured model).

**Suggested sequencing:** Slice 1 (guide tool coverage) is the most
mechanical and lowest-risk — do it first to validate the
`GUIDE_TOOLS`/`interpretations.ts`/`gen:skill`/`docsSync` loop still holds for
new entries. Slice 2 depends on the `TOOL_INTERPRETATIONS` entries added in
Slice 1 for the new tools (though it can proceed independently for commands
whose interpretations already exist). Slice 3 is independent and can be done
in parallel or last.

**Status:** ✅ complete.

**Deviations from spec:**
- Slice 1's `diff <ref1> <ref2> <query>` entry was deferred: the existing
  `semantic_diff` `GUIDE_TOOLS` entry (used by the conceptual `diff` command)
  already covers this case, so no separate `ref_diff`/`concept_diff` tool was
  added.
- Slice 2 incidentally fixed a pre-existing bug in `heatmap`'s CLI
  registration (`src/cli/register/all.ts`): `--out <spec>` was a registered
  option but was never forwarded to `heatmapCommand`. The action wrapper now
  forwards both `out` and the new `narrate` option.
- Slice 3's optional narrator/guide step (step 7) only offers local Ollama
  configuration, matching the spec's "if Ollama is detected" framing; HTTP/CLI
  narrator backends are configured separately via `gitsema models add`.

---

## Knowledge Graph Track (Phases 105–112) — ✅ complete

> **Full design:** [`docs/knowledge-graph.md`](knowledge-graph.md) is the single
> design reference for this track (two-level symbol identity, schema, per-language
> name-resolution heuristics, edge taxonomy, traversal layer, the `--lens` toggle,
> and the new-command catalog). Phase entries below are summaries — do not restate
> the design here; update the design doc instead.

**Motivation.** gitsema is semantic-embedding-first: vectors, FTS, and relational
metadata already agree on one canonical ID (`blob_hash`). What's missing is a
**structural truth layer** — typed, queryable, temporally-aware edges
(`calls`/`imports`/`defines`/`extends`) between **stable symbol nodes**. Today
`symbols` carry only a bare name/kind/line-range with an unstable auto-increment PK,
extraction walks only top-level `rootNode.namedChildren`, and `impact.ts` coupling
is purely semantic. This track adds the graph without violating blob-first /
immutable / Git-is-truth.

**Core decision (two-level identity).** Immutable per-blob *symbol occurrences* are
**path-free** (dedup'd by blob hash, like embeddings — a blob maps to many paths and
is parsed once), keyed by `(blob_hash, qualified_name, signature_hash)`. Recomputable
*graph nodes* (`file` | `symbol` | `external`) carry path: the path-bearing
`symbol_key = path#qualified_name#signature_hash` is **derived** at node-build by
joining occurrences × `paths`, so duplicate content at two paths fans out to two
nodes. Edges connect nodes and carry Git provenance (`first/last_seen_commit`), so
temporal edges come for free. Graph is **relational-only** (SQLite + Postgres
recursive CTEs); Qdrant `GraphStore` fails loud (cf. review9 §4). First languages:
**TS/JS + Python**, then Go/Rust/Java.

**Three lenses, not two (the `--lens` toggle).** Structural is an *additive third
lens*, never a replacement — **Semantic** (vectors/FTS) · **Temporal**
(git/`blob_commits`) · **Structural** (graph edges). A cross-cutting
`--lens semantic|structural|hybrid` + `--weight-structural` extends the existing
three-signal ranker to four signals. `semantic` reproduces today's behavior exactly,
so existing commands default to it and nothing is lost; new graph-native commands
default to `structural`; fusion commands default to `hybrid`. New commands unlocked
include `co-change`, `deps`, `cycles`, `callers`/`callees`/`path`/`neighbors`,
`blast-radius`, `relate`, `unused`, and `hotspots`, plus `--lens` upgrades to
`impact`/`code-review`/`explain`/`guide`/`triage` (see design doc §7–§8).

| Phase | Title | Schema | Deliverable |
|---|---|---|---|
| **105** ✅ | Stable symbol identity | v24 | Recursive scope-stack extraction → path-free `qualified_name`, `signature`, `signature_hash`, `parent_qualified_name` on `symbols`. Path-bearing `symbol_key` is derived at display/node-build, not stored. `code_search`/LSP `documentSymbol` show `Class.method(sig)`. No edges; independently useful; de-risks the rest. |
| **106** ✅ | Per-blob structural extraction | v25 | `structural_refs` (immutable, dedup by blob hash) populated during `index --graph` for TS/JS + Python. Sites only, no resolution. |
| **107** ✅ | Linking pass + `graph_nodes`/`edges` | v26 | `gitsema graph build` builds `file`/`symbol`/`external` nodes (occurrences × `paths`), resolves refs → typed edges with confidence tiers; materializes `co_change` from `blob_commits`. Early CLI: `co-change`, `deps`, `cycles`. |
| **108** | Traversal primitives + CLI/MCP | — | `GraphStore` seam (recursive CTEs); `gitsema graph callers\|callees\|neighbors\|path`; MCP `call_graph`/`graph_neighbors`. |
| **109** | `--lens` toggle + structural ranking | — | Cross-cutting `--lens` + `--weight-structural` in the re-rank loop; new commands `blast-radius`, `relate`, `similar --lens`, `unused`; `impact` gains `--lens`. Semantic stays the default for existing commands. |
| **110** ✅ | Fusion: cascade planner + hotspots | — | Cascade query planner (`FTS → vector → graph traversal → merge/rerank`); `hotspots`; structural enrichment of `code-review`/`explain`/`guide`/`triage`. |
| **111** ✅ | Lens coverage & parity sweep | — | Cross-cutting adoption pass over the whole command surface (CLI + MCP + HTTP): shared `addLensOption()` helper, uniform §7.3 defaults + per-hit lens labeling, docs/skill/`interpretations.ts` parity, and a test asserting every lens-capable command exposes `lens`. Done before the UI phase so it covers the 110 fusion commands too. |
| **112** ✅ | Unified graph UI (HTML + CLI) | — | Render subgraphs in HTML (reuse `htmlRenderer-clusters.ts` force-graph); nodes deep-link into existing per-command HTML views — binds the standalone HTML outputs together. Also adds a CLI/text-mode subgraph view (ASCII tree or list rendering of nodes/edges) for terminal-only workflows, alongside the HTML view. |

Each phase ends with working software, tests, a `features.md` entry, a `PLAN.md`
status update, and a changeset. **Start point: Phase 105** (isolated, test-heavy,
ships qualified names before any edge depends on it).

**Status:** Phase 105 ✅ complete. `extractSymbolMetadata()`
(`src/core/chunking/functionChunker.ts`) recursively walks TS/TSX/JS/Python ASTs
with a scope stack, producing path-free `qualifiedName`/`signature`/`signatureHash`/
`parentQualifiedName` for every symbol (including nested class methods); other
languages return `[]` (graceful degradation, fields stay `null`). Schema v24 adds
the four nullable `symbols` columns + `(qualified_name, signature_hash)` and
`(blob_hash, qualified_name)` indexes (sqlite migration, fresh-DB DDL, and Postgres
DDL/ALTER). The four fields are threaded through `VectorRecord`, `RerankCandidate`,
`SearchResult`, sqlite/Postgres/Qdrant write and read paths, `code_search` /
`renderResults()` (shows `qualifiedName(signature)`, falling back to `symbolName`),
and the LSP `documentSymbol` handler. **Deviation from the original sketch:** chunk
and embedding *granularity* remains top-level-only (preserving existing chunking
tests/behavior) — nested symbols (e.g. class methods) are not separately chunked or
embedded, but their identity metadata is still captured by `extractSymbolMetadata()`
and exposed via the top-level chunk's `parentQualifiedName`-filtered match. Per-method
chunking/embedding, if wanted, is left to a later phase.

**Status:** Phase 106 ✅ complete. `extractStructuralRefs()`
(`src/core/chunking/structuralRefs.ts`) reuses the Phase 105 tree-sitter grammars and
scope-stack walk to record raw, unresolved structural references — `import`, `call`,
`extends`, `implements` — for TS/TSX/JS/Python; other languages and parse failures
return `[]` (graceful degradation, same contract as Phase 105). Each ref carries an
`enclosingQualifiedName` that lines up with Phase 105's `qualifiedName` for the same
scope (`undefined` = file/top-level). Schema v25 adds the immutable, dedup-by-`blob_hash`
`structural_refs` table (+ `(blob_hash)` and `(ref_kind, raw_target)` indexes) via
sqlite migration `025_structural_refs.ts`, fresh-DB DDL, and Postgres DDL. The storage
seam gains `MetadataStore.storeStructuralRefs()`, implemented for both
`SqliteMetadataStore` and `PostgresMetadataStore` (and therefore the Qdrant profile too,
since it reuses `PostgresMetadataStore` for relational data — **no Qdrant deviation**).
Indexing is gated behind a new `gitsema index start --graph` flag, wired through
`runIndex()`'s batch and non-batch paths (`IndexStats.structuralRefs` tracks rows
stored). No `graph_nodes`/`edges` or resolution — that is Phase 107.

**Status:** Phase 107 ✅ complete. `gitsema graph build`
(`src/core/graph/build.ts`) is a truncate-and-rebuild linking pass: it groups
`symbols` occurrences (joined against `paths`) by `(path, qualifiedName,
signatureHash)` into `symbol:<path>#<qname>#<sighash>` nodes (picking the
most-recently-committed blob as `currentBlobHash`), mints `file:<path>` nodes for
every known path, and emits `contains`/`defines` edges from `parentQualifiedName`.
`structural_refs` rows are resolved to typed edges (`imports`/`calls`/`extends`/
`implements`/`references`) via the knowledge-graph §4 confidence tiers: same-file
(1.0) → imported-and-resolved (0.9) → project-wide-unique by last name segment
(0.6) → ambiguous, nearest-by-directory-distance (0.3, `weight` = candidate count)
→ unresolved (0, minted as an `external:<name>` node). `co_change` edges are
materialized bidirectionally from `blob_commits`/`commits`/`paths`, weighted by
co-occurrence count with `firstSeenCommit`/`lastSeenCommit` provenance. Schema v26
adds `graph_nodes` and `edges` (+ `(src_key, edge_type)` / `(dst_key, edge_type)`
indexes) via sqlite migration `026_graph_nodes_edges.ts`, fresh-DB DDL, and Postgres
DDL. The storage seam gains a `GraphStore` interface (`replaceAll`, `countNodes`,
`countEdges`, `getNode`, `allNodes`, `allEdges`, `edgesFor`), implemented for sqlite
and Postgres; the Qdrant profile uses `UnsupportedGraphStore`, which fails loud with
a clear error (per review9 §4 — graph queries require a relational backend). Early
CLI surface: `gitsema graph build`, `gitsema co-change <path>`, `gitsema deps
<identifier>` (with `--reverse`/`--depth`/`--edge-types`), and `gitsema graph
cycles` / top-level `gitsema cycles` alias (DFS cycle detection over `imports` by
default). **Deviations from the original sketch:** (1) external nodes use
`external:<name>` (this phase's spec) rather than `ext:<raw_name>` from
knowledge-graph.md §2.3 — kept for consistency with the task's authoritative
node-key contract; (2) `firstSeenCommit`/`lastSeenCommit` are only populated for
`co_change` edges, not structural edges (would require extra blob→commit joins not
essential to the core linking pass); (3) `CO_CHANGE_MAX_FILES_PER_COMMIT = 50` caps
pairwise co-change computation per commit to avoid O(n²) blowup on
vendoring/lockfile-regeneration commits. Traversal primitives
(callers/callees/path/neighbors) and the `--lens` toggle remain out of scope —
Phase 108/109.

**Status:** Phase 108 ✅ complete. The `GraphStore` interface
(`src/core/storage/types.ts`) gains five traversal primitives —
`neighbors`/`callers`/`callees`/`path`/`subgraph` — plus `GraphHit`, `GraphPath`,
`GraphPathHop`, `GraphSubgraph`, and a shared `MAX_GRAPH_TRAVERSAL_DEPTH = 3`
constant (knowledge-graph §6). Both `SqliteGraphStore` and `PostgresGraphStore`
implement them via recursive CTEs over `edges`/`graph_nodes`
(`src/core/storage/sqlite/graphTraversal.ts` and
`src/core/storage/postgres/graphTraversal.ts`): a `WITH RECURSIVE` walk with a
`ROW_NUMBER() OVER (PARTITION BY node_key ORDER BY depth)` window picks the
shortest-depth hit (and its edge type) per reached node for
`neighbors`/`callers`/`callees`/`subgraph`; `path` uses a second recursive CTE that
accumulates a delimited path string (`node|edgeType|reversed|node|...`) and returns
the shortest match. All traversal depths are clamped to
`MAX_GRAPH_TRAVERSAL_DEPTH` (`callers`/`callees`/`path`/`subgraph` default to 3;
`neighbors` defaults to 1). `UnsupportedGraphStore` throws the same
"graph queries require a relational backend" error for all five new methods, per
review9 §4. A new `src/core/graph/traversal.ts` wraps the primitives with
`resolveNode()` (Phase 107) for identifier resolution, backing four new CLI
commands — `gitsema graph callers <symbol> [--depth]`, `gitsema graph callees
<symbol> [--depth]`, `gitsema graph neighbors <node> [--edge-types] [--direction]
[--depth]`, and `gitsema graph path <a> <b>` — and two new MCP tools, `call_graph`
(callers/callees over `calls` edges) and `graph_neighbors` (typed neighborhood, any
edge kinds), registered in `src/mcp/tools/graph.ts`. **Deviation from the original
sketch:** `call_graph`/`graph_neighbors` are not yet added to the `gitsema guide`
`GUIDE_TOOLS` registry (46 tools) or `interpretations.ts` — left for the Phase 110
fusion pass / Phase 111 lens-coverage sweep, consistent with `docsSync`'s existing
guard (which only requires every `GUIDE_TOOLS` entry to have an interpretation, not
that every MCP tool is in `GUIDE_TOOLS`). No schema change. Tests:
`tests/graphTraversal.test.ts`.

**Status:** Phase 109 ✅ complete. Adds the cross-cutting `--lens
semantic|structural|hybrid` toggle (knowledge-graph §7/§8) plus a fourth ranking
signal in `vectorSearch` (`src/core/search/analysis/vectorSearch.ts`):
`weightStructural`/`structuralScores` extend the three-signal formula to
`score = (wv*cosine + wr*recency + wp*pathScore + ws*structScore) / wTotal`, where
`structScore` comes from a precomputed `Map<blobHash, number>` of structural
proximity (`1 / (1 + hops)`) from a query anchor. When neither option is set
(the default for every existing caller), `useWeightedSignals` and the formula are
unchanged from before Phase 109 — semantic-lens output is byte-for-byte identical.
A shared `src/cli/lib/lens.ts` provides `parseLens()`, `lensWeights()`, and
`addLensOption()` (adds `--lens <lens>` and `--weight-structural <n>` to a
Commander command). Four new core modules under `src/core/graph/` back four new
top-level commands:
- `blastRadius` (`blastRadius.ts`) → `gitsema blast-radius <symbol> [--lens]
  [--depth] [-k/--top]` (default lens: hybrid) — structural dependents via
  `graph.neighbors(node, {edgeTypes: BLAST_RADIUS_EDGE_TYPES, direction: 'in',
  depth})` (calls/imports/extends/implements/references) and/or semantically
  similar blobs/symbols.
- `relate` (`relate.ts`) → `gitsema relate <symbol> [-k/--top]` — depth-1
  callers + depth-1 callees (labeled, structural) plus semantically similar
  blobs/symbols — "both lenses, lose neither", no `--lens` flag (always shows all
  three sections).
- `similar` (`similar.ts`) → `gitsema similar <symbol> [--lens] [-k/--top]`
  (default lens: hybrid) — structural similarity ranks nodes of the same `kind` by
  Jaccard overlap of their outgoing edge targets (`imports` for files, `calls` for
  symbols by default); semantic similarity ranks by embedding cosine similarity.
- `unused` (`unused.ts`) → `gitsema unused [--edge-types]` — file/function/class/
  method nodes with no inbound `calls`/`imports` edges (excludes `external:*`
  nodes); the structural complement to the semantic `dead-concepts` command.

The "semantic similarity without an embedding provider" lookup
(`src/core/graph/semanticNeighbors.ts`, `semanticNeighborsForNode()`) ranks stored
`embeddings`/`symbol_embeddings` rows by cosine similarity to the resolved graph
node's own stored embedding (file nodes use `currentBlobHash`'s whole-file
embedding; symbol nodes parse `symbol:<path>#<qualifiedName>#<signatureHash>` and
use the matching `symbol_embeddings` row) — no network call. It returns
`{supported: false, hits: []}` on non-sqlite backends, and all four new commands
(plus `impact`'s blast-radius alias) render `(not supported on this storage
backend)` for the semantic section in that case rather than throwing. Shared
rendering helpers (`renderResolutionError`, `renderBlastRadius`) live in
`src/cli/lib/graphRender.ts`.

`gitsema impact <path> --lens structural|hybrid` becomes a thin alias over
`blastRadius()` (knowledge-graph §8): the path is normalized to a `file:<path>`
graph node and delegated entirely to `blastRadius()`/`renderBlastRadius()`,
including `--dump`/`--out json` support. `--lens semantic` (the default) preserves
the pre-Phase-109 `computeImpact()` code path exactly.

**Deviations from the original sketch:** (1) `--weight-structural` is accepted by
`blast-radius`/`similar`/`impact` for consistency with the shared `--lens` option
helper, but the new fusion commands rank their structural/semantic sections
independently (Jaccard / graph-distance / cosine) rather than through
`vectorSearch`'s four-signal blend — `--weight-structural` only affects ranking
when `--lens` flows into `vectorSearch` directly (not yet wired for any CLI
command in this phase; the four-signal formula itself is tested and ready for a
future search-integration phase). (2) No new MCP tools were added for
`blast-radius`/`relate`/`similar`/`unused` — left for a future fusion/MCP-coverage
phase, consistent with the Phase 108 deviation note. No schema change. Tests:
`tests/graphLens.test.ts`.

**Status:** Phase 110 ✅ complete (knowledge-graph §7/§8/§10). Three deliverables:

1. **Cascade query planner** (`src/core/graph/cascade.ts`, `planCascade()`): the
   four-stage `FTS filter → vector expand → graph traversal → merge/rerank`
   pipeline. Stage 1 BM25-pre-filters via `profile.fts` (skipped when absent);
   stage 2 runs `vectorSearch`; stage 3 maps the top semantic hits to `file`
   nodes and expands along `calls`/`imports`/`extends`/`implements`/`references`
   edges (`1/(1+hops)` proximity); stage 4 unions + reranks under a lens-weighted
   blend, labeling each hit with the contributing lens(es). `lens: 'semantic'`
   short-circuits after stage 2 and returns the vector ranking unchanged
   (byte-identical); structural stages catch `UnsupportedGraphStore` and degrade
   to semantic-only (`structuralSupported: false`).
2. **`gitsema hotspots`** (`src/core/graph/hotspots.ts`, CLI
   `src/cli/commands/hotspots.ts`, MCP `hotspots`, `POST /api/v1/graph/hotspots`):
   architectural risk = co-change (temporal) × call-coupling (structural) ×
   churn, computed as a geometric mean of the normalized signals the lens
   selects (`hybrid` = all three, `structural` = coupling only, `semantic` =
   co-change × churn). Coupling/co-change come from the graph; churn from
   `churnByPath()` (sqlite `blob_commits`). Default lens hybrid; per-hit lens
   labels in text/JSON.
3. **Structural enrichment** of `code-review`, `triage`, `explain`, `guide` via a
   new `--lens` flag (default `semantic`, byte-identical). `triage` runs the
   cascade planner for a "Structural context" section; `code-review`/`explain`
   use `structuralContextForPath()` (`src/core/graph/structuralContext.ts`) for
   "N callers / co-changes with X NN%" facts; `guide` gains the `call_graph`,
   `blast_radius`, and `hotspots` tools in `GUIDE_TOOLS` (closing the Phase 108
   deviation) and a lens hint. **Deviations:** (1) the cascade planner is wired
   behind `hybrid` for the query-driven fusion paths (`triage`/`explain`
   enrichment) rather than retrofitted into the already-tested anchor-based
   `blast-radius`/`relate`/`similar` section output, whose hybrid behavior was
   left intact; `hotspots` fuses the three lenses through its own risk product
   (as the design specifies) rather than the cascade. (2) `explain` enrichment is
   path-scoped (uses `--files`) to avoid an embedding/network call in the
   evidence path. Tests: `tests/graphFusion.test.ts`.

**Status:** Phase 111 ✅ complete (knowledge-graph §7.3/§11). The shared
`addLensOption()` helper (`src/cli/lib/lens.ts`) is now applied uniformly to every
command where more than one lens is meaningful — `blast-radius`/`similar`/`relate`/
`hotspots` (fusion → default `hybrid`) and `impact`/`triage`/`code-review`/
`explain`/`guide` (existing → default `semantic`) — enforcing the §7.3 defaults.
New graph-native commands keep their `structural` default. Per-hit lens labels
(`[semantic]`/`[structural]`/`[semantic+structural]`) are rendered consistently
across the cascade, hotspots, and relate text/JSON output. The MCP `hotspots` tool
and `POST /api/v1/graph/hotspots` route both expose `lens`. Docs/skill parity is
restored: `interpretations.ts` gains `call_graph`/`blast_radius`/`hotspots`
entries, `pnpm gen:skill` regenerated `skill/gitsema-ai-assistant.md` +
`.github/skills/gitsema.md`, and `features.md`/`README.md` tables are updated. A
new mechanical parity test (`tests/lensParity.test.ts`, mirroring `docsSync`'s
style) introspects the Commander program, `GUIDE_TOOLS`, and the MCP/HTTP source to
assert every lens-capable surface exposes `lens`/`--lens` with the correct default.
**Deviation:** single-lens graph-native commands (`co-change` temporal-only;
`deps`/`cycles`/`callers`/`callees`/`neighbors`/`path`/`unused` structural-only) do
not take `--lens` — only one lens is meaningful for them — so they are excluded
from the parity set by design. No schema change.

**Status:** Phase 112 ✅ complete (knowledge-graph §9). Adds a unified
`RenderableSubgraph` model (`src/core/graph/subgraphView.ts`: `rootKeys`, `nodes`,
`edges`, optional per-node `weights`) so the six traversal/fusion commands —
`graph neighbors`, `graph path`, `blast-radius`, `relate`, `similar`, `hotspots` —
render through one shape instead of six bespoke result types.
`subgraphFromSeed`/`subgraphFromSeeds` delegate to the Phase 108 `GraphStore.subgraph()`
(the real, depth-bounded node-induced subgraph) rather than re-deriving edges from a
flat `GraphHit[]` list; `subgraphFromPath` follows a `graph path` result's exact hop
chain; `subgraphFromHotspots` keeps only the hotspot cohort's nodes and the
coupling/co-change edges among them, carrying `risk` as the per-node weight. Each
command gains `--out <spec>` support (`text|json[:file]|html[:file]|markdown[:file]`,
the existing project-wide convention — `hotspots` already had it for `text`/`json`
and now adds `html`/`markdown`):
- **HTML force-graph** (`src/core/viz/htmlRenderer-graph.ts`, `renderGraphHtml()`) —
  reuses the canvas-based force-sim pattern and `BASE_CSS`/`COMMON_JS`/`safeJson()`
  helpers from `htmlRenderer-clusters.ts`/`htmlRenderer-shared.ts`. Clicking a node
  opens a detail sidebar with its kind/path/weight/key and **suggested follow-up CLI
  commands** (`suggestedCommands()`, e.g. `gitsema file-evolution <path> --out
  html:evolution.html`) as the "deep link" into other per-command HTML views — copyable
  commands rather than literal hyperlinks, since the target HTML files aren't
  guaranteed to exist yet (there is no live server backing these standalone files).
- **CLI/text-mode subgraph view** (`src/cli/lib/graphRender.ts`, `renderGraphTree()`) —
  an indented ASCII tree rooted at `rootKeys`, with `-[edgeType]->` hop labels and
  `(...)` markers for already-visited nodes (cycle-safe). A parallel
  `renderGraphMarkdown()` renders the same subgraph as a nested bullet list for the
  `markdown` sink.
- `src/cli/lib/graphOutput.ts` (`emitSubgraphOutputs()`) dispatches a resolved
  `OutputSpec[]` to the right renderer per sink, shared by all six commands.

**Deviations from the original sketch:** (1) deep links are suggested CLI commands,
not `<a href>` hyperlinks, for the reason above; (2) when `--out` is not passed, each
command's pre-existing bespoke text rendering is completely unchanged — the new
`renderGraphTree()` only backs an *explicit* `--out text`, so this phase adds no
default-output behavior change; (3) `suggestedCommands()` lives in
`src/core/graph/subgraphView.ts` (not `src/cli/lib/`) so that the core-layer
`htmlRenderer-graph.ts` does not import from `src/cli/` (core never depends on cli,
per the architecture in `CLAUDE.md`) — it returns plain command-string templates with
no Commander/CLI dependency, so this stays comfortably within core. Tests:
`tests/subgraphView.test.ts`, `tests/graphOutput.test.ts`.

---

## Deployment scenarios & usage envisioning

The architecture of gitsema supports three distinct deployment scenarios, each with different operational models and target users. This section clarifies the intended usage patterns and the infrastructure requirements for each.

### Scenario 1: Single-developer, local (no infra, zero setup)

**Target:** Individual developers, small teams, local-only usage  
**Install:** `npx gitsema` (ephemeral) or `npm install -g gitsema` (persistent)  
**Index location:** `.gitsema/index.db` (repo-local SQLite)  
**Network:** None required  
**Repos indexed:** One per local directory

**Workflow:**
```bash
cd /path/to/my/repo
npx gitsema index            # embeds all blobs once, dedup by content hash
npx gitsema search "auth"    # query the local index
npx gitsema tools mcp        # expose to Claude Code or local MCP client (stdio)
```

**Key properties:**
- Zero infrastructure: no server, no external services (unless using an HTTP embedding provider)
- Embedding provider runs locally (Ollama) or via HTTP (OpenAI-compatible); gitsema CLI calls it directly
- Index is SQLite, stored alongside the repo (git-ignored)
- Content-addressed blob deduplication (same blob on different branches/commits is embedded once)
- All analysis (search, evolution, clustering, graphs) runs locally in-process

**Limitations:**
- Index is per-repo, not shared across machines
- If a developer switches machines, they must re-index (but `gitsema index --since` + content addressing means only *new* blobs are embedded)
- MCP communication is stdio-only (no network transport in this scenario)

**Use case examples:**
- Developer exploring their local monorepo
- Incident triage: "when did this pattern first appear?"
- Learning codebase history before contributing

---

### Scenario 2: Single-developer (or small team), self-hosted (multi-location, incremental, multiple repos)

**Target:** Individual developers who work across multiple machines (home, lab, office); small teams with a shared CI/CD host  
**Install:** `npx gitsema` (CLI on client machines) + Docker (server on remote host)  
**Index location:** Remote: `.gitsema/` directory on the server; Client: Git repo only (cloned locally)  
**Network:** HTTP between client CLI and remote server  
**Repos indexed:** Multiple repos on the server; client accesses one at a time

**Architecture (Model A: client repos, server index):**
- Client owns and manages the Git repository (cloned, committed, pushed locally)
- Server owns the embedding index and index database
- Client runs `gitsema index --remote <http://server:4242> [--since <ref>]` to trigger incremental indexing
- Blobs are sent to the remote server only for embedding (if client doesn't have an embedding provider)
- Index database is persisted on the server (`.gitsema/index.db`)

**Workflow:**
```bash
# On machine A (home)
cd ~/myrepo && git pull
gitsema index --remote http://server:4242 --since <last-indexed-commit>
gitsema search "auth" --remote http://server:4242

# On machine B (lab)
cd ~/myrepo && git pull
gitsema index --remote http://server:4242 --since <last-indexed-commit>
gitsema search "auth" --remote http://server:4242
```

**Key properties:**
- Incremental indexing via `--since` (skips commits already processed)
- Content-addressed blobs: identical code at the same path on both machines produces the same blob hash → no re-embedding
- Server stores multiple repo indexes (e.g. `~/.gitsema/repos/{repo1,repo2}/index.db`)
- Embedding provider can run on the server (Ollama in Docker) or externally (HTTP API)
- MCP server runs on the remote host (HTTP transport via `gitsema tools serve`); client connects via HTTP

**Limitations:**
- Requires a persistent remote host (VPS, NAS, office server)
- Network latency for every search / analysis query
- Scaling limited by single-server embedding throughput (solve with batching + multi-GPU in Phase 62+)

**Use case examples:**
- Developer working from home and office, needing the same semantic context
- Small team sharing a CI-indexed repository without sharing code checkout
- Persistent indexing: "which commits introduced this security issue?"

---

### Scenario 3: Multi-developer, hosted (shared infrastructure, incremental, scoped access)

**Target:** Teams with multiple developers; organizations with cross-team code analysis needs  
**Install:** Docker Compose (Postgres + Qdrant + gitsema + embedding backend); `npx gitsema` CLI on client machines  
**Index location:** Postgres (metadata + FTS) + Qdrant (vectors); persisted on server  
**Network:** HTTP between client CLI and remote server  
**Repos indexed:** Multiple repos shared across the organization  
**Access control:** Per-repo tokens via `gitsema config set --global remoteKey <token>`

**Architecture (same Model A, extended):**
- Server hosts multiple repository indexes in a shared Postgres + Qdrant backend
- Blobs are stored with per-repo isolation (via `storage.scope` configuration)
- Each developer has a `.gitsema/config.json` with `remoteUrl` and `remoteKey`
- Personal branches can be excluded from shared indexes (via branch filtering at index time)

**Workflow:**
```bash
# Developer 1 (team A)
gitsema config set --global remoteUrl http://server:4242
gitsema config set --global remoteKey <token-for-repo-A>
cd ~/repo-a && gitsema index  # incremental, scoped to repo A on shared server
gitsema search "database layer" # queries repo-A index only

# Developer 2 (team B, same server)
gitsema config set --global remoteUrl http://server:4242
gitsema config set --global remoteKey <token-for-repo-B>
cd ~/repo-b && gitsema index  # incremental, scoped to repo B
gitsema search "API endpoints" # queries repo-B index only
```

**Key properties:**
- Shared infrastructure reduces per-repo deployment cost
- Postgres supports concurrent writes (with careful locking) and multi-repo scoping
- Qdrant provides vector search at scale (millions of embeddings)
- FTS via Postgres tsvector or pg_search (Phase 102+)
- Per-repo tokens allow fine-grained access control
- All developers contribute to a unified index (optional: exclude personal branches)

**Advanced options (future phases):**
- **Index merging:** "Shared main + personal branches" — administrators can configure whether developers see each other's work-in-progress branches or only released main
- **Multi-repo search:** `gitsema search "auth pattern" --repos repo-a,repo-b` (Phase 50 + multi-tenant scoping)
- **Query-level time travel:** "Show this pattern as of Q2 2024 vs. Q3 2024"

**Limitations:**
- Requires operational overhead (Postgres, Qdrant, network tuning)
- Index consistency during concurrent indexing (mitigated by incremental indexing + commit-based locking)
- Cost scales with storage (vectors + FTS) and query volume

**Use case examples:**
- Organization onboarding new developers: "show me how authentication is done across our codebases"
- Security team: "where is this vulnerability pattern present?" (search across all repos)
- Architecture review: "which teams own this module, and what do they change most frequently?"
- Automated incident response: "when did this pattern first appear, and on which branches?"

---

### Web UI (Phase 112+)

The three scenarios above use CLI and HTTP API. A web UI (to be built) will provide:

- **Interactive query interface** — form-based search, filtered by date/branch/path
- **Graph visualization** — render `graph_nodes` + `edges` as an interactive force-directed graph (reuse Phase 55's HTML renderer patterns)
- **Temporal heatmaps** — show codebase "hotness" by time and module
- **Drill-down views** — click a search result to see its evolution timeline, related code, structural context
- **Multi-repo dashboard** — admin view of indexed repos, indexing status, token management
- **API documentation** — OpenAPI spec with interactive Swagger UI (Phase 71)

The web UI will work in all three scenarios:
- **Scenario 1 (local):** Served via `gitsema tools serve --ui --port 8080`; browser connects to `localhost:8080`
- **Scenario 2 (self-hosted):** Docker image exposes port 4242; browser connects to `http://server:4242`
- **Scenario 3 (multi-dev):** Same Docker setup; per-repo token scoping applies to web UI requests too

---

### Protocol integration: MCP over HTTP (not SSE)

MCP (Model Context Protocol) is used by Claude Code and other AI clients to call tools. gitsema currently supports:
- **Scenario 1:** `gitsema tools mcp` (stdio-only; for local development tools like VS Code)
- **Scenario 2–3:** `gitsema tools serve` (HTTP API; but `gitsema tools mcp` remains stdio-only)

**Design decision:** No Server-Sent Events (SSE) transport for MCP in Scenario 2–3. Instead:
- The HTTP API (`gitsema tools serve`) exposes RESTful routes for all MCP tools (Phase 72)
- OpenAPI/Swagger documents the routes
- Client tools (Claude Code, custom scripts) call HTTP endpoints directly rather than speaking MCP protocol over SSE
- This avoids transport complexity and leverages the existing HTTP server infrastructure

**Future possibility:** If a true MCP-over-HTTP transport emerges as a standard, it can be added as an HTTP endpoint that bridges HTTP ↔ MCP stdio (not requiring SSE).

---

### Testing & validation across scenarios

To ensure functionality works in all scenarios, the following test strategy is needed:

**Unit tests (all scenarios):**
- Indexing, deduplication, search, graph traversal (existing `tests/` suite)
- Remote client behavior (HTTP error handling, retry logic)
- Per-repo token scoping (access control)

**Integration tests (per scenario):**

| Scenario | Test setup | Validations |
|---|---|---|
| 1 (local) | Real Git repo + local Ollama | `gitsema index` completes; `search` returns results; `gitsema tools mcp` starts |
| 2 (self-hosted) | Docker server + client CLI on separate machine | Incremental `--since` works; blob dedup verified (same hash on different commits); `--remote` flag works; same index accessible from multiple clients |
| 3 (multi-dev) | Docker Compose (Postgres + Qdrant) + 2+ client CLIs | Per-repo token isolation; concurrent indexing doesn't corrupt index; multi-repo search works; branch filtering works |

**Functional validation:**
- Search quality is unchanged across local/remote (same `vectorSearch` algorithm)
- Evolution timelines work correctly (temporal queries over shared indexes)
- Clustering and graph traversal are consistent whether running locally or remotely
- Web UI (Phase 112+) renders results correctly in all scenarios

**Performance benchmarks (Phase 114+):**
- Scenario 1: embedding throughput on commodity hardware (target: 1000 blobs/min)
- Scenario 2: network overhead — measure latency of search/analysis queries over HTTP
- Scenario 3: Postgres/Qdrant throughput at scale (100k+ blobs, 10+ concurrent clients)

---

### Usage envisioning: how developers actually use gitsema

**Day 1: Onboarding**
- New hire clones the company repo locally
- Runs `gitsema index` (or Scenario 3: `gitsema index --remote <team-server>`)
- Searches for "authentication", "database", "API" to understand codebase structure
- Uses `gitsema guide` (agentic tool loop) to ask "how is error handling done here?" — the guide pulls together search results, commit history, and structural context

**Week 1: Feature development**
- Developer picks up a ticket: "Add OAuth 2.0 support"
- Runs `gitsema first-seen "oauth"` to see when the OAuth module was first added, by whom
- Runs `gitsema related-work "oauth"` (Phase 109) to see structural and semantic neighbors — modules that import oauth, modules that are frequently co-changed with it
- Uses `gitsema code-review --lens structural` on their pull request to see what code paths they've broken (blast radius)
- In Claude Code, invokes `call_graph` (Phase 108) to verify their changes don't introduce cycles

**Week 2: Incident response**
- Production issue: "OAuth token expiration causes intermittent auth failures"
- Runs `gitsema bisect "oauth token expiration"` (Phase 38) to find the commit where the bug was introduced
- Runs `gitsema evolution "src/auth/oauth.ts"` to see semantic drift — was there a refactor that introduced the bug?
- Runs `gitsema explain "oauth token expiration" --narrate` to get an LLM summary of the issue with commit evidence
- Uses `triage` (Phase 65) for a bundle of evidence: first-seen, change points, evolution, experts

**Ongoing: codebase health**
- Monthly: `gitsema hotspots` (Phase 110) shows which code is most risky (high churn + high coupling)
- Quarterly: `gitsema policy-check` (Phase 66) enforces debt thresholds — fails CI if technical debt score is too high
- Annually: `gitsema narrate --since 2025-01-01 --until 2026-01-01` generates a development timeline for the year

**Team workflows:**
- Code review: reviewer uses `gitsema code-review <branch>` to see what's changing semantically, not just syntactically
- Architecture review: "does this module fit our layering?" — use `impact` + `graph neighbors` to see coupling
- Refactoring: "is it safe to delete this function?" — use `unused` (Phase 109) to check for callers

**Cross-team collaboration (Scenario 3):**
- Team A owns "auth", Team B owns "API", Team C owns "frontend"
- Team A runs `gitsema search "API client" --repos repo-frontend,repo-api` to see how frontend talks to API
- Architecture committee reviews `gitsema multi-repo-search "error handling"` to see patterns across teams
- When a vulnerability is found in a dependency, the security team runs `gitsema security-scan` (Phase 58) across all repos

---

### Implementation roadmap for scenarios

**Already implemented (Phases 1–112):**
- Scenario 1: Local indexing, search, MCP stdio server
- Scenario 2 (partial): Remote HTTP API (`gitsema tools serve`), incremental indexing via `--since`
- Scenario 3 (partial): Postgres/Qdrant backends, per-repo isolation in schema
- Unified graph UI: HTML force-graph + CLI ASCII-tree subgraph rendering (Phase 112)

**Needed for Scenario 2 (self-hosted single-developer):**
- [Phase 73+] Deployment guide: Docker Compose template, environment variables, quickstart
- [Phase 15-17] Multi-location workflow: `--remote` CLI flag, client-side `--since` logic

**Needed for Scenario 3 (multi-dev, shared infrastructure):**
- [Phase 75] Per-repo access control: token validation, per-token repo scoping
- [Phase 102–103] Pluggable backends: Postgres metadata + vectors, Qdrant vectors
- [Phase 101] Index scoping: `storage.scope` configuration, multi-tenant isolation

**Needed for all scenarios + Web UI:**
- [Phase 114+] Web UI: interactive search, graph viz, temporal heatmaps, token management
- [Phase 116+] Performance: VSS/HNSW for faster search, query caching, incremental indexing optimizations

This roadmap ensures that gitsema evolves from a developer tool (Scenario 1) to a team infrastructure (Scenario 3) without breaking backward compatibility or forcing large architectural rewrites.
