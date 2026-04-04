# gitsema — Command Review: Indexing & Clustering Feature Adoption

**Reviewed against:** v0.32.0  
**Date:** 2026-04-04  
**Scope:** All 27 CLI commands, the MCP server (9 tools), and the HTTP API server.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Feature Map](#2-feature-map)
3. [Command-by-Command Analysis](#3-command-by-command-analysis)
   - 3.1 [Setup & Infrastructure](#31-setup--infrastructure)
   - 3.2 [Search & Discovery](#32-search--discovery)
   - 3.3 [File History](#33-file-history)
   - 3.4 [Concept History](#34-concept-history)
   - 3.5 [Cluster Analysis](#35-cluster-analysis)
   - 3.6 [Change Detection](#36-change-detection)
4. [Cross-Cutting Concerns](#4-cross-cutting-concerns)
5. [MCP Server Gap Analysis](#5-mcp-server-gap-analysis)
6. [HTTP Server Gap Analysis](#6-http-server-gap-analysis)
7. [Prioritised Next Steps](#7-prioritised-next-steps)

---

## 1. Executive Summary

gitsema has grown through 32+ phases. Each phase added powerful capabilities — symbol-level indexing, module-level centroid embeddings, commit message embeddings, branch filtering, k-means clustering, temporal cluster diffing, change-point detection, HTML visualisations, query embedding cache, and enhanced cluster labels — but these features were primarily wired into the **new** commands of each phase. Older commands were left untouched.

The result is a **two-tier system**: newer commands (cluster analysis, change detection, branch-aware commands) are richly featured, while foundational commands like `first-seen`, `author`, `impact`, `dead-concepts`, and the semantic blame/diff commands are stranded at their original capability level.

**Top three findings:**

1. **`buildProvider()` is copy-pasted into at least nine command files** (`search`, `author`, `impact`, `changePoints`, `semanticBlame`, `semanticDiff`, `conceptEvolution`, `index`, `serve`) with identical implementation. There is already a shared pattern in `src/mcp/server.ts` (`getTextProvider()`). This should be extracted to `src/core/embedding/providerFactory.ts`.

2. **The query embedding cache (`src/core/embedding/queryCache.ts`, Phase 18) is used only in `search`.** Every other query-embedding command (`first-seen`, `author`, `change-points`, `concept-evolution`, `diff`, `semantic-blame`) calls `provider.embed()` directly and re-pays the embedding latency on every invocation.

3. **Branch filtering (`--branch`)** is supported by `vectorSearch` via the `blob_branches` table (Phase 15 + schema v2), but is exposed on only two commands (`search`, `index`). Eleven other commands that call `vectorSearch` or compute cluster snapshots do not accept a `--branch` flag.

---

## 2. Feature Map

The table below shows which **newer shared features** each command uses today versus what it plausibly _should_ use.

Legend: ✅ implemented · ⬜ not applicable · 🔶 partial · ❌ gap (should be added)

| Command | Hybrid search | Commit embeds | Symbol level | Module level | Branch filter | HTML output | Query cache | Enhanced labels |
|---|---|---|---|---|---|---|---|---|
| **search** | ✅ | ✅ | ✅ | ✅ | ✅ | ⬜ | ✅ | ⬜ |
| **first-seen** | ❌ | ❌ | ❌ | ❌ | ❌ | ⬜ | ❌ | ⬜ |
| **dead-concepts** | ❌ | ⬜ | ⬜ | ⬜ | ❌ | ❌ | ⬜ | ⬜ |
| **author** | ❌ | ❌ | ⬜ | ⬜ | ❌ | ❌ | ❌ | ⬜ |
| **file-evolution** | ⬜ | ⬜ | ❌ | ⬜ | ❌ | ❌ | ⬜ | ⬜ |
| **file-diff** | ⬜ | ⬜ | ❌ | ❌ | ⬜ | ⬜ | ⬜ | ⬜ |
| **blame** | ⬜ | ⬜ | ❌ | ⬜ | ⬜ | ❌ | ❌ | ⬜ |
| **impact** | ❌ | ⬜ | ❌ | ✅ | ❌ | ❌ | ❌ | ⬜ |
| **concept-evolution** | ⬜ | ⬜ | ⬜ | ⬜ | ❌ | ✅ | ❌ | ⬜ |
| **diff** (semantic) | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ❌ | ⬜ |
| **clusters** | ⬜ | ⬜ | ⬜ | ❌ | ❌ | ✅ | ⬜ | ✅ |
| **cluster-diff** | ⬜ | ⬜ | ⬜ | ⬜ | ❌ | ✅ | ⬜ | ✅ |
| **cluster-timeline** | ⬜ | ⬜ | ⬜ | ⬜ | ❌ | ✅ | ⬜ | ✅ |
| **branch-summary** | ⬜ | ⬜ | ⬜ | ✅ | ✅ | ❌ | ⬜ | ⬜ |
| **merge-audit** | ⬜ | ⬜ | ⬜ | ⬜ | ✅ | ⬜ | ⬜ | ⬜ |
| **merge-preview** | ⬜ | ⬜ | ⬜ | ⬜ | ✅ | ✅ | ⬜ | ✅ |
| **change-points** | ⬜ | ⬜ | ⬜ | ⬜ | ❌ | ❌ | ❌ | ⬜ |
| **file-change-points** | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ❌ | ⬜ | ⬜ |
| **cluster-change-points** | ⬜ | ⬜ | ⬜ | ⬜ | ❌ | ❌ | ⬜ | ❌ |

---

## 3. Command-by-Command Analysis

### 3.1 Setup & Infrastructure

---

#### `config` — `src/cli/commands/config.ts`

**What it does:** Reads/writes the global (`~/.config/gitsema/config.json`) and local (`.gitsema/config.json`) config files via `src/core/config/configManager.ts`. Supports `set`, `get`, `list`, `unset` sub-commands with `--global`/`--local` scopes. Also manages Git hook installation (`hooks.enabled`).

**Feature gaps:** None — this command is purely configuration plumbing and does not interact with the embedding index.

**Improvements:**
- Expose the full list of valid keys with their defaults in `--help` output (currently users must read the README).
- `config list` shows raw JSON; a tabular format (key · scope · value) would be easier to scan.

---

#### `status` — `src/cli/commands/status.ts`

**What it does:** Reports index statistics (blob count, commit count, last-indexed date). With `[file]` argument reports per-file blob info.

**Feature gaps:**
- No stats on **chunk, symbol, or module embeddings** (all added in Phases 21–33).
- No stats on **commit embeddings** (Phase 30).
- `--remote <url>` option exists but the remote client method `remoteStatus` queries only basic blob counts; newer table counts are not proxied.

**Improvements:**
- Add row counts for `chunks`, `chunk_embeddings`, `symbols`, `symbol_embeddings`, `commit_embeddings`, `module_embeddings`, and `blob_branches` to the summary output.
- Add a `--json` flag for machine-readable status.

---

#### `index` — `src/cli/commands/index.ts`

**What it does:** Full indexing pipeline via `runIndex()` (`src/core/indexing/indexer.ts`). Supports incremental (`--since`), concurrency control, extension/size/path filtering, chunker strategy, branch tracking.

**Feature gaps:** This command is the most fully-featured in the repository. Only minor gaps remain:
- `--level` flag exists on `search` but `index` doesn't let the user choose *which* levels to index (blobs only, blobs+chunks, blobs+chunks+symbols). All levels are always computed when the chunker supports it.
- No `--dry-run` flag to estimate the work without writing.

**Improvements:**
- Add a `--dry-run` / `--estimate` flag that reports blobs to be indexed without committing.
- Document the multi-level fallback chain (whole-file → function → fixed 1500 → fixed 800) in `--help` output.

---

#### `update-modules` — `src/cli/commands/updateModules.ts`

**What it does:** Recomputes directory-level centroid embeddings (`module_embeddings` table) without re-running the full indexer.

**Feature gaps:**
- Only `--verbose` flag; no `--module <path>` to restrict the update to a single directory subtree.
- No `--force` flag to reset and recompute all modules even if their blob set is unchanged.

**Improvements:**
- Add `--module <prefix>` to limit recalculation to a subtree (useful for large monorepos after partial re-indexing).

---

#### `backfill-fts` — `src/cli/commands/backfillFts.ts`

**What it does:** Populates the `blob_fts` FTS5 virtual table for blobs indexed before Phase 11.

**Feature gaps:** None for its narrow purpose.

**Improvements:**
- Mention this command in the `--hybrid` flag description of `search` so users know they must run it first on older indexes.

---

#### `serve` — `src/cli/commands/serve.ts`

**What it does:** Starts the HTTP API server (`src/server/app.ts`) on `--port` (default 4242) with optional Bearer token auth (`--key`).

**Feature gaps:**
- `--chunker` and `--concurrency` flags on `serve` configure the *server-side* indexer, but there is no `--level` flag to choose which indexing levels (blobs / chunks / symbols / modules) the server enables.
- Server routes do not expose the clustering, change-point, or branch-summary endpoints (see §6).

---

#### `remote-index` — `src/cli/commands/remoteIndex.ts`

**What it does:** Triggers indexing on a remote gitsema server by passing repository URL + credentials.

**Feature gaps:**
- No `--db-label` validation feedback (the flag is passed but not surfaced in error messages).
- No support for `--branch` (branch tracking is disabled in the remote path).

---

#### `mcp` — `src/cli/index.ts` (line 680)

Starts the MCP stdio server. See §5 for a full gap analysis.

---

### 3.2 Search & Discovery

---

#### `search` — `src/cli/commands/search.ts`

**What it does:** The flagship search command. Supports vector search, hybrid BM25+vector, chunk/symbol/module levels, branch filtering, time filtering, recency blending, three-signal ranking, commit message search, query embedding cache, remote proxy, result grouping.

**Feature gaps:** This is the most fully-featured command. Minor gaps:
- `--group module` uses module path (directory), but `module_embeddings` vectors are not used to *rank* modules; only representative paths per module are used. A `--level module` search ranks by module centroid similarity.
- No `--json` / `--dump` flag for machine-readable output (all other complex commands have `--dump`).
- No `--enhanced-labels` / clustering context in the output to show which semantic cluster a result belongs to.

**Improvements:**
- Add `--dump [file]` for JSON output (consistent with all other commands).
- Optionally annotate each result with its nearest cluster label (from `blob_clusters` / `cluster_assignments` tables).

---

#### `first-seen` — `src/cli/commands/firstSeen.ts`

**What it does:** Finds blobs that match a query and re-sorts them chronologically by first commit date. Wraps a bare `vectorSearch()` call.

**Feature gaps (all significant):**
- ❌ **No query cache.** The command calls `provider.embed(query)` directly. `getCachedQueryEmbedding` / `setCachedQueryEmbedding` from `src/core/embedding/queryCache.ts` are not used.
- ❌ **No `--branch` flag.** `vectorSearch` already accepts `branch` in its options object (`src/core/search/vectorSearch.ts:74`). Adding `--branch <name>` would cost three lines.
- ❌ **No `--hybrid` flag.** Hybrid BM25+vector re-ranking (available since Phase 11) would improve precision for keyword-heavy queries.
- ❌ **No `--include-commits`** flag. Commit embeddings (Phase 30) allow finding the first commit whose *message* matches a concept.
- ❌ **No `--level` flag.** Symbol-level embeddings (Phase 33) are ignored; only whole-file embeddings are searched.
- ❌ **No `--dump`** flag for JSON output.
- ❌ **No `--before`/`--after` date filters** (already present in `search` and backed by the same `vectorSearch` options).

**Code location:** `src/cli/commands/firstSeen.ts:56-66`

**Recommended changes:**
```
firstSeenCommand() should mirror searchCommand() for all flags that feed vectorSearch():
  --branch, --before, --after, --hybrid, --bm25-weight, --level, --no-cache, --dump
```

---

#### `dead-concepts` — `src/cli/commands/deadConcepts.ts`

**What it does:** Finds blobs that are in the semantic index but absent from the current HEAD tree — "dead code" detected by semantic drift. Uses `findDeadConcepts()` from `src/core/search/deadConcepts.ts`.

**Feature gaps:**
- ❌ **No `--branch` flag.** The definition of "HEAD" is implicitly the current checkout. With branch-aware filtering it could report concepts dead *on a specific branch*.
- ❌ **No `--html [file]` flag.** An interactive visualisation would help exploration (comparable to `clusters --html`).
- ❌ **No cluster context.** Results could be annotated with their cluster label from the `cluster_assignments` table, helping developers understand which semantic area of the codebase the dead code belonged to.

---

#### `author` — `src/cli/commands/author.ts`

**What it does:** Identifies which authors contributed most to a semantic concept by scoring blob × commit × author triples.

**Feature gaps:**
- ❌ **No query cache.** Same issue as `first-seen`; `provider.embed()` is called directly.
- ❌ **No `--branch` flag.** Attribution is computed across all branches; a branch-scoped view would be valuable (e.g., "who contributed authentication logic to the `feature/auth` branch?").
- ❌ **No `--hybrid` flag.** Only vector search is used to find relevant blobs; hybrid scoring would surface more relevant blobs from BM25.
- ❌ **No `--html [file]` flag.** A bar-chart or table HTML view would be useful for presentations.
- ❌ **No `--include-commits`** option. Commit message embeddings could be used to find commits relevant to the query and then attribute those commits to authors.

**Code location:** `src/cli/commands/author.ts:51-53`; `src/core/search/authorSearch.ts`

---

### 3.3 File History

---

#### `file-evolution` (alias: `evolution`) — `src/cli/commands/evolution.ts`

**What it does:** Tracks the semantic drift of a single file path across its Git history. Computes cosine distance between consecutive blob versions. Supports `--threshold`, `--alerts`, `--dump`, `--include-content`, `--remote`.

**Feature gaps:**
- ❌ **No symbol-level granularity.** The command embeds the whole blob at each version. Symbol embeddings (Phase 33) would let users track how individual *functions* evolved, not just the whole file.
- ❌ **No `--branch` flag.** The file history is computed from `git log -- <path>` (all branches). A `--branch` option would filter to a single branch's history.
- ❌ **No `--html [file]` flag.** The equivalent `concept-evolution` command gained HTML output (Phase 25); `file-evolution` did not.
- ❌ **No cluster annotation.** Showing which semantic cluster each historical version belonged to would help understand architectural drift.

**Code location:** `src/cli/commands/evolution.ts`; `src/core/search/evolution.ts:103`

---

#### `file-diff` (alias: `diff`) — `src/cli/commands/diff.ts`

**What it does:** Computes cosine distance between two versions of a file (`<ref1> <ref2> <path>`). Optionally shows nearest-neighbour blobs for each version.

**Feature gaps:**
- ❌ **No symbol-level diff.** The command computes the distance between whole-file embeddings. Symbol embeddings would allow a function-level semantic diff ("which functions changed semantically?").
- ❌ **Module embedding comparison is absent.** `module_embeddings` could show whether the module centroid drifted between refs.
- This command (`src/cli/commands/diff.ts`) is distinct from the *semantic diff* command (`src/cli/commands/semanticDiff.ts`). The naming is potentially confusing: `gitsema diff` does a file-level semantic diff, while `gitsema diff <ref1> <ref2> <query>` is a concept-level diff. They are registered separately in `src/cli/index.ts`.

---

#### `blame` (alias: `semantic-blame`) — `src/cli/commands/semanticBlame.ts`

**What it does:** Divides the current HEAD version of a file into semantic blocks, then finds the nearest-neighbour blobs in the index for each block.

**Feature gaps:**
- ❌ **No symbol embeddings.** The command embeds raw text blocks heuristically; it does not use the `symbol_embeddings` table (added Phase 33). Using pre-indexed symbol embeddings would be faster and more precise.
- ❌ **No query cache.** Each block is re-embedded from scratch on every run.
- ❌ **No `--html [file]` flag.** A side-annotated view would be a natural UX improvement.
- ❌ **No `--branch` flag** to restrict neighbours to blobs seen on a specific branch.

**Code location:** `src/cli/commands/semanticBlame.ts`; `src/core/search/semanticBlame.ts:143`

---

#### `impact` — `src/cli/commands/impact.ts`

**What it does:** Given a file path, finds semantically coupled blobs in the index using the target blob's embedding. Reports module groupings.

**Feature gaps:**
- ❌ **No `--branch` flag.** Impact analysis limited to a branch would be useful before a branch merge.
- ❌ **No `--html [file]` flag.** Impact results lend themselves to a visual coupling graph.
- ❌ **No symbol-level search.** `computeImpact()` calls `vectorSearch()` which supports `searchSymbols`. The `--chunks` flag already exists; `--symbols` would add symbol-level coupling.
- ❌ **No query cache.** The target file's embedding is retrieved from the database but the *search* step re-embeds nothing; however, if the file is *not* indexed, the fallback embeds it live without caching.
- 🔶 **Module groupings** are present but the `module_embeddings` table could improve module-to-module coupling scores by using centroid similarity rather than blob-to-blob maximum.

**Code location:** `src/cli/commands/impact.ts`; `src/core/search/impact.ts`

---

### 3.4 Concept History

---

#### `concept-evolution` — `src/cli/commands/conceptEvolution.ts`

**What it does:** Traces how a semantic concept evolved across the entire codebase using `computeConceptEvolution()`. Supports `--dump`, `--html`, `--include-content`, `--remote`.

**Feature gaps:**
- ❌ **No query cache.** `provider.embed()` is called directly at `src/cli/commands/conceptEvolution.ts:174`.
- ❌ **No `--branch` flag.** `computeConceptEvolution()` uses all blobs. A branch filter would scope the timeline.
- ❌ **No `--level` flag.** Only whole-file embeddings are searched; chunk/symbol granularity would surface more targeted changes.

---

#### `diff` (semantic diff) — `src/cli/commands/semanticDiff.ts`

**What it does:** Given two Git refs and a topic query, classifies blobs into *gained*, *lost*, or *stable* relative to the query. Uses `computeSemanticDiff()` from `src/core/search/semanticDiff.ts`.

**Feature gaps:**
- ❌ **No query cache.** The topic query is re-embedded on every run.
- ❌ **No `--branch` flag.** Blobs at each ref include all branches.
- ❌ **No `--html [file]` flag.** A visual before/after view would be very useful.
- ❌ **No `--level` flag.** Only whole-file embeddings are compared.

---

### 3.5 Cluster Analysis

---

#### `clusters` — `src/cli/commands/clusters.ts`

**What it does:** Runs k-means clustering on all blob embeddings. Reports cluster labels, keywords (from FTS5), representative paths, centroid concept edges. Supports `--dump`, `--html`, `--enhanced-labels`.

**Feature gaps:**
- ❌ **No `--branch` flag.** Clustering operates on all indexed blobs regardless of branch. Branch-scoped clustering (`getBlobHashesUpTo` already exists at `src/core/search/clustering.ts:593`; a `getBlobHashesOnBranch` variant is missing) would enable per-branch concept maps.
- ❌ **No `--level` flag.** Clustering is always on whole-file embeddings. Clustering on chunk or symbol embeddings would give finer-grained topic models.
- ❌ **No `--save-clusters` flag** to persist k-means results to the `blob_clusters` / `cluster_assignments` tables so that other commands (like `search --annotate`) can annotate results with cluster labels.

**Note:** The `blob_clusters` and `cluster_assignments` tables exist in the schema (`src/core/db/schema.ts`) but are never written by the `clusters` command today — they appear to be reserved for a future "persist clusters" phase.

---

#### `cluster-diff` — `src/cli/commands/clusterDiff.ts`

**What it does:** Computes cluster snapshots at two Git refs and shows centroid drift, blob migration (inflows/outflows), and new/dissolved clusters.

**Feature gaps:**
- ❌ **No `--branch` flag.** Both snapshots use all blobs up to the ref timestamp. Adding per-branch scoping would let users compare cluster maps of two branches.
- ❌ **No `--level` flag.** Clusters are always on whole-file embeddings.

---

#### `cluster-timeline` — `src/cli/commands/clusterTimeline.ts`

**What it does:** Computes evenly-spaced cluster snapshots between `--since` and `--until` refs, tracks centroid drift, and flags large structural changes.

**Feature gaps:**
- ❌ **No `--branch` flag.**
- ❌ **No `--level` flag.**
- ❌ **No `--save-snapshots` flag** to persist timeline results for replay/comparison.

---

#### `branch-summary` — `src/cli/commands/branchSummary.ts`

**What it does:** Computes a semantic summary of a branch relative to a base. Uses `computeBranchSummary()` which extracts branch-exclusive blobs, computes a mean centroid, and finds nearest cluster centroids.

**Feature gaps:**
- ❌ **No `--html [file]` flag.** Given that `merge-preview` has an HTML view, `branch-summary` would benefit from a comparable visualisation.
- The `--base` flag defaults to `main` but does not fall back to `master`. If the default branch is neither, it silently returns empty results.

---

#### `merge-audit` — `src/cli/commands/mergeAudit.ts`

**What it does:** Detects semantic collisions (high-similarity blobs on two diverged branches) that could cause logical merge conflicts.

**Feature gaps:**
- ❌ **No `--html [file]` flag.** Collision pairs would be much easier to navigate as a visual table.
- 🔶 **Collision scoring uses cosine similarity between whole-file embeddings.** Symbol-level embeddings (Phase 33) would surface function-level collisions that whole-file scoring misses.

---

#### `merge-preview` — `src/cli/commands/mergePreview.ts`

**What it does:** Shows how a branch's cluster structure would integrate with the target. Computes merge impact via `computeMergeImpact()`. Supports `--html`, `--dump`, `--enhanced-labels`.

**Feature gaps:** This is the most feature-complete cluster analysis command. Minor gaps:
- ❌ **No `--level` flag.**
- The HTML output (`renderClusterDiffHtml`) is shared with `cluster-diff`. A dedicated merge-preview template with branch name annotations would improve clarity.

---

### 3.6 Change Detection

---

#### `change-points` — `src/cli/commands/changePoints.ts`

**What it does:** Finds commits where a semantic concept shifted significantly using `computeConceptChangePoints()`. Scores similarity between query and per-commit blob centroids.

**Feature gaps:**
- ❌ **No query cache.** `provider.embed()` is called directly at `src/cli/commands/changePoints.ts:126`.
- ❌ **No `--branch` flag.** Change points are computed across all commits. A branch filter would restrict to commits reachable from a named branch.
- ❌ **No `--html [file]` flag.** A timeline visualisation would help developers understand when architectural changes occurred.

---

#### `file-change-points` — `src/cli/commands/fileChangePoints.ts`

**What it does:** Detects version-to-version semantic shifts in a single file. Uses `computeFileChangePoints()`.

**Feature gaps:**
- ❌ **No `--html [file]` flag.**
- ❌ **No `--branch` flag** to filter the file's commit history to a single branch.
- ❌ **No symbol-level granularity.** Change-points are detected at the whole-file level; detecting changes at the symbol level would pinpoint *which function* changed.

---

#### `cluster-change-points` — `src/cli/commands/clusterChangePoints.ts`

**What it does:** Detects commits where the overall cluster structure shifted significantly using `computeClusterChangePoints()`.

**Feature gaps:**
- ❌ **No `--branch` flag.**
- ❌ **No `--html [file]` flag.**
- ❌ **No `--enhanced-labels`** flag. Change-point output shows cluster labels; enhanced labels (TF-IDF, identifier splitting) from `src/core/search/labelEnhancer.ts` (Phase 24) would produce better cluster names.

---

## 4. Cross-Cutting Concerns

### 4.1 Duplicated `buildProvider()` Function

The following files each contain an **identical** `buildProvider(providerType, model)` function:

| File | Lines |
|---|---|
| `src/cli/commands/search.ts` | 41–52 |
| `src/cli/commands/author.ts` | 16–26 |
| `src/cli/commands/impact.ts` | 26–36 |
| `src/cli/commands/changePoints.ts` | 22–33 |
| `src/cli/commands/semanticBlame.ts` | 22–32 |
| `src/cli/commands/semanticDiff.ts` | 14–24 |
| `src/cli/commands/conceptEvolution.ts` | 21–31 |
| `src/cli/commands/index.ts` | 242–252 |
| `src/cli/commands/serve.ts` | 16–26 |
| `src/mcp/server.ts` | 42–50 (as `buildProvider` + `getTextProvider`) |

**Recommendation:** Extract to `src/core/embedding/providerFactory.ts` with exports:
```ts
export function buildProvider(type: string, model: string): EmbeddingProvider
export function getTextProvider(): EmbeddingProvider
export function getCodeProvider(): EmbeddingProvider
```
All ten locations import from there. The MCP server already has a local pattern (`getTextProvider`) that could become the canonical implementation.

---

### 4.2 Query Embedding Cache Not Widely Used

`src/core/embedding/queryCache.ts` (Phase 18) caches `(queryText, model) → vector` in the `query_embeddings` SQLite table. It is used **only** in `search` (`src/cli/commands/search.ts:60-61`).

Commands that call `provider.embed(query)` without caching:

| Command | File | Location |
|---|---|---|
| `first-seen` | `src/cli/commands/firstSeen.ts` | line 56 |
| `author` | `src/cli/commands/author.ts` | line 53 |
| `change-points` | `src/cli/commands/changePoints.ts` | line 126 |
| `concept-evolution` | `src/cli/commands/conceptEvolution.ts` | line 174 |
| `diff` (semantic) | `src/cli/commands/semanticDiff.ts` | line 105 |
| `semantic-blame` | `src/cli/commands/semanticBlame.ts` | per-block embedding |
| MCP tools | `src/mcp/server.ts` | multiple |

**Recommendation:** Replace direct `provider.embed()` calls with a shared helper that wraps the cache:
```ts
// src/core/embedding/embedQuery.ts
export async function embedQuery(provider: EmbeddingProvider, query: string): Promise<number[]> {
  const cached = getCachedQueryEmbedding(query, provider.model)
  if (cached) return cached
  const vec = await provider.embed(query)
  setCachedQueryEmbedding(query, provider.model, vec)
  return vec
}
```

---

### 4.3 Branch Filtering Gap

`vectorSearch()` accepts `branch?: string` at `src/core/search/vectorSearch.ts:74`, backed by the `blob_branches` table (schema v2, Phase 15). But `--branch` is exposed on only two commands:

- `search` — yes
- `index` — yes (tracks blobs to branch during indexing)
- All other 11+ search/analysis commands — **no**

**Recommendation:** Add `--branch <name>` to: `first-seen`, `author`, `dead-concepts`, `impact`, `concept-evolution`, `change-points`, `clusters`, `cluster-diff`, `cluster-timeline`, `cluster-change-points`, `file-evolution`, `file-change-points`.

For clustering commands this requires passing the branch to `getBlobHashesUpTo()` or adding a `getBlobHashesOnBranch()` helper that queries `blob_branches`.

---

### 4.4 Inconsistent `--dump` / JSON Output

Most commands have a `--dump [file]` flag for JSON output, but:

| Command | Has `--dump`? |
|---|---|
| `search` | ❌ (missing) |
| `first-seen` | ❌ (missing) |
| `blame` | ✅ |
| `file-evolution` | ✅ |
| `concept-evolution` | ✅ |
| `clusters` | ✅ |
| `author` | ✅ |
| `impact` | ✅ |
| `change-points` | ✅ |
| `dead-concepts` | ✅ |

`search` and `first-seen` are the highest-traffic commands and lack machine-readable output, which prevents them from being used in pipelines.

---

### 4.5 HTML Output Inconsistency

`--html [file]` is available on:

- `clusters`, `cluster-diff`, `cluster-timeline` (Phase 25)
- `concept-evolution` (Phase 25)
- `merge-preview` (Phase 32)

But **not** on: `file-evolution`, `change-points`, `file-change-points`, `cluster-change-points`, `dead-concepts`, `author`, `impact`, `branch-summary`.

The HTML renderer (`src/core/viz/htmlRenderer.ts`) already supports multiple chart types. Adding HTML output to the remaining timeline/analysis commands would require adding render functions to `htmlRenderer.ts` — the infrastructure is already in place.

---

### 4.6 Enhanced Labels Not Used Outside Cluster Commands

`src/core/search/labelEnhancer.ts` (Phase 24) improves cluster labels using TF-IDF + identifier splitting. The `--enhanced-labels` flag exists on `clusters`, `cluster-diff`, `cluster-timeline`, `merge-preview` but is absent from:

- `cluster-change-points` — cluster labels appear in change-point output
- `branch-summary` — shows nearest cluster names
- `merge-audit` — reports concept zone cluster labels

---

### 4.7 Error Handling Inconsistency

Most commands catch embedding errors and call `process.exit(1)`, but:

- `first-seen` does not catch the `vectorSearch()` call (it can throw if the DB session is not initialised).
- `dead-concepts` wraps `findDeadConcepts()` in a try/catch but not the `parseDateArg()` call.
- Several commands call `parseInt()` on user flags without a `NaN` guard (e.g., `--k` in `clusterChangePoints`).

---

### 4.8 Missing `--verbose` / `GITSEMA_VERBOSE` in Some Commands

The `logger.ts` module respects `GITSEMA_VERBOSE=1`, but several commands (notably `dead-concepts`, `first-seen`, `file-change-points`) do not set `logger.verbose` from the `--verbose` global flag, making debug tracing inconsistent.

---

## 5. MCP Server Gap Analysis

The MCP server (`src/mcp/server.ts`) exposes **9 tools** today:

| Tool | Backed by |
|---|---|
| `semantic_search` | `vectorSearch()` |
| `search_history` | `vectorSearch()` with time filter + chronological sort |
| `first_seen` | `vectorSearch()` sorted chronologically |
| `evolution` | `computeEvolution()` (file-level) |
| `concept_evolution` | `computeConceptEvolution()` |
| `index` | `runIndex()` |
| `branch_summary` | `computeBranchSummary()` |
| `merge_audit` | `computeSemanticCollisions()` |
| `merge_preview` | `computeMergeImpact()` |

**Missing MCP tools** (CLI commands with no MCP equivalent):

| CLI Command | Why it would be valuable in MCP |
|---|---|
| `clusters` | AI clients could request a concept map of the codebase |
| `cluster-diff` | Compare codebase structure at two refs from within Claude |
| `cluster-timeline` | Understand how the codebase evolved over time |
| `cluster-change-points` | Find structurally significant commits |
| `change-points` | Find when a concept underwent major shifts |
| `author` | Attribute concepts to contributors |
| `impact` | Assess refactor risk from within an AI coding session |
| `dead-concepts` | Surface stale code for cleanup |
| `diff` (semantic) | Compare concept coverage between two refs |
| `blame` (semantic) | Annotate a file with semantic neighbours |

**Other MCP gaps:**
- None of the MCP tools use the query embedding cache.
- `semantic_search` does not support `--level`, `--hybrid`, or `--include-commits`.
- The `index` tool does not report `IndexStats` back to the client (it returns a string summary, not structured data).

---

## 6. HTTP Server Gap Analysis

The HTTP server (`src/server/app.ts`) exposes routes for:

- `POST /embed` — single string embedding
- `POST /embed-batch` — batch embedding
- `POST /store` — blob storage
- `POST /search` — vector search
- `GET /status` — index status
- `POST /remote-index` — trigger remote indexing

**Missing routes:**
- `POST /clusters` — cluster analysis
- `POST /cluster-diff` — temporal cluster diff
- `POST /author` — author attribution
- `POST /impact` — refactor impact
- `POST /change-points` — change detection
- `POST /dead-concepts` — dead concept detection

These omissions mean the remote-client pattern (`src/client/remoteClient.ts`) cannot proxy any of the analysis commands to a central server. Only indexing and basic search are proxied.

---

## 7. Prioritised Next Steps

The following items are ordered by impact (most valuable first) and grouped by effort.

### Priority 1 — Quick wins (< 1 hour each)

1. **Extract `buildProvider()` to `src/core/embedding/providerFactory.ts`** and update all 10 call sites. Eliminates ~100 lines of duplication. No behaviour change.

2. **Add `embedQuery()` helper wrapping the query cache** and use it in `first-seen`, `author`, `change-points`, `concept-evolution`, `diff`, and MCP tools. Eliminates repeated embedding latency on re-runs with the same query.

3. **Add `--dump [file]` to `search` and `first-seen`** for JSON output, consistent with all other commands.

4. **Add `--branch <name>` to `first-seen`** — `vectorSearch` already supports it; it's a one-line option registration and a pass-through.

### Priority 2 — High-value feature additions (1–3 hours each)

5. **Add `--branch <name>` to `author`, `dead-concepts`, `impact`, `concept-evolution`, `change-points`** — all call `vectorSearch` internally.

6. **Add `--branch <name>` to `clusters`, `cluster-diff`, `cluster-timeline`, `cluster-change-points`** — requires a `getBlobHashesOnBranch(branchName)` helper in `clustering.ts` (analogous to `getBlobHashesUpTo()`).

7. **Add `--hybrid` to `first-seen` and `author`** — pass `hybrid: true` and `bm25Weight` to `vectorSearch`.

8. **Add `--include-commits` to `first-seen`** — use `searchCommits()` from `src/core/search/commitSearch.ts` and merge results before chronological sort.

9. **Add `--enhanced-labels` to `cluster-change-points`, `branch-summary`, and `merge-audit`** — all display cluster labels; the `enhanceClusterLabels()` call in `labelEnhancer.ts` is self-contained.

### Priority 3 — Medium-effort improvements (3–8 hours each)

10. **Add `--html [file]` to `file-evolution`, `change-points`, `file-change-points`, `cluster-change-points`** — add render functions to `src/core/viz/htmlRenderer.ts` (the pattern is established in Phase 25).

11. **Add `--html [file]` to `branch-summary`, `merge-audit`, and `dead-concepts`**.

12. **Add symbol-level search to `impact` and `blame`** — `vectorSearch` already supports `searchSymbols: true`; it is used in `search` but not in `impact` or `semantic-blame`.

13. **Add `status` output for all indexing levels** — extend `src/cli/commands/status.ts` to report row counts for `chunks`, `chunk_embeddings`, `symbols`, `symbol_embeddings`, `commit_embeddings`, `module_embeddings`.

### Priority 4 — Larger refactors / new capabilities (> 8 hours each)

14. **Persist cluster results to `blob_clusters` / `cluster_assignments`** — add a `--save-clusters` flag to `clusters` so that `search` can annotate results with their cluster label (the tables already exist in the schema).

15. **Add missing MCP tools** — at minimum: `clusters`, `change_points`, `author`, `impact`, `dead_concepts`.

16. **Add HTTP server routes for analysis commands** — enables the remote-server pattern for `author`, `impact`, `change-points`, `clusters`.

17. **Add `--level symbol` to `file-evolution` and `file-change-points`** — function-level semantic history would be one of the most powerful features in the tool.

18. **Add a `getBlobHashesOnBranch()` helper to `src/core/search/clustering.ts`** to properly support branch-scoped clustering (as opposed to using `getBlobHashesUpTo()` which is timestamp-based, not branch-based).

---

*End of review.*
