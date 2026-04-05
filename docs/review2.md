# Code Review 2 — Feature Completeness, Performance, and Next Steps

Comprehensive review of the gitsema codebase at v0.35.0 (36 phases). Covers three areas:

1. **Feature Completeness** — do all commands use the features available to them?
2. **Performance** — bottlenecks, memory issues, and optimization opportunities.
3. **Next Steps** — missing features that leverage gitsema's unique capabilities.

---

## Part 1 — Feature Completeness

### Summary

After reviewing all **28 CLI commands**, **13 MCP tools**, and **16 HTTP routes**, there are **significant feature-adoption gaps**. Many cross-cutting features added in later phases were only adopted by the `search` command but not propagated to other search-capable commands. The MCP server and HTTP API also lack parity with CLI features.

**Totals**: 13 critical gaps, 16 important gaps, 12 nice-to-have gaps, 8 missing MCP tools, 10 missing HTTP routes.

### 1.1 `--hybrid` (BM25 + Vector Fusion)

| Command | Has it? | Should it? | Notes |
|---------|:-------:|:----------:|-------|
| `search` | ✅ | — | Primary search |
| `author` | ✅ | — | |
| `first-seen` | ✅ | — | |
| `semantic-diff` | ❌ | **YES** | Uses `embedQuery()` + cosine — same pattern as `author` |
| `concept-evolution` | ❌ | **YES** | Uses `embedQuery()` + cosine |
| `change-points` | ❌ | **YES** | Uses `embedQuery()` + cosine |
| MCP `semantic_search` | ❌ | **YES** | CLI `search` supports it; MCP should too |
| HTTP `/search` | ✅ | — | |

### 1.2 `--branch` (Restrict to Branch)

| Command | Has it? | Should it? |
|---------|:-------:|:----------:|
| `search`, `author`, `first-seen`, `impact`, `concept-evolution`, `change-points`, `clusters`, `cluster-timeline`, `cluster-change-points`, `cluster-diff`, `dead-concepts` | ✅ | — |
| `evolution` | ❌ | **YES** |
| `semantic-diff` | ❌ | **YES** |
| `semantic-blame` | ❌ | **YES** |
| `file-change-points` | ❌ | **YES** |
| MCP `semantic_search` | ❌ | **YES** |
| MCP `search_history` | ❌ | **YES** |

### 1.3 `--html` (HTML Visualization)

Already supported by: `evolution`, `concept-evolution`, `clusters`, `cluster-diff`, `cluster-timeline`, `cluster-change-points`, `change-points`, `file-change-points`, `dead-concepts`, `merge-audit`, `merge-preview`, `branch-summary`.

**Missing (would need new renderers):**

| Command | Priority |
|---------|----------|
| `search` | Important — most-used command, universal visualization target |
| `author` | Important — contribution charts |
| `impact` | Important — coupling graph is a natural viz |
| `semantic-diff` | Important — side-by-side concept comparison |
| `semantic-blame` | Nice-to-have — annotated source view |
| `first-seen` | Nice-to-have — timeline chart |

### 1.4 `--dump` / `--include-content` (JSON Output)

Broadly adopted. **One gap:** `diff` command has structured results but no `--dump` flag.

### 1.5 `--vss` (usearch HNSW ANN Search)

| Command | Has it? | Should it? |
|---------|:-------:|:----------:|
| `search` | ✅ | — |
| `author` | ❌ | **YES** — performs vector search via cosine |
| `first-seen` | ❌ | **YES** — calls `vectorSearch()` directly |
| HTTP `/search` | ❌ | **YES** — CLI supports it |

### 1.6 `--model` / `--text-model` / `--code-model` (Multi-Model)

| Command | Has it? | Should it? |
|---------|:-------:|:----------:|
| `search`, `index`, `evolution`, `concept-evolution`, `semantic-diff`, `first-seen`, `clusters` | ✅ | — |
| `author` | ❌ | **YES** — calls `embedQuery(provider, query)` |
| `impact` | ❌ | **YES** — calls `provider.embed(content)` |
| `semantic-blame` | ❌ | **YES** — calls `provider.embed(chunk.content)` |
| `change-points` | ❌ | **YES** — calls `embedQuery(provider, query)` |
| MCP tools | ❌ | **YES** — all MCP tools use hardcoded providers |

### 1.7 `--include-commits` (Commit Message Embedding Search)

| Command | Has it? | Should it? |
|---------|:-------:|:----------:|
| `search` | ✅ | — |
| `first-seen` | ✅ | — |
| `author` | ❌ | **YES** — could include commit message matches |
| MCP `semantic_search` | ❌ | **YES** |

### 1.8 `--chunks` (Chunk-Level Search)

| Command | Has it? | Should it? |
|---------|:-------:|:----------:|
| `search`, `impact` | ✅ | — |
| `author` | ❌ | **YES** — chunk-level author attribution |
| `first-seen` | ❌ | **YES** — chunk-level first-appearance |
| MCP `semantic_search` | ❌ | **YES** |

### 1.9 `--level` (Search Level: blob/chunk/module)

| Command | Has it? | Should it? |
|---------|:-------:|:----------:|
| `search`, `impact`, `evolution`, `semantic-blame`, `file-change-points` | ✅ | — |
| `first-seen` | ❌ | **YES** |
| `author` | ❌ | **YES** |
| MCP `semantic_search` | ❌ | **YES** |
| HTTP `/search` | ❌ | **YES** |

### 1.10 MCP Tool Coverage

**13 tools present.** Key missing CLI command equivalents:

| Missing MCP Tool | CLI Command | Priority |
|-----------------|-------------|----------|
| `semantic_diff` | `semantic-diff` | **High** |
| `semantic_blame` | `semantic-blame` | **High** |
| `diff` | `diff` | **Medium** |
| `file_change_points` | `file-change-points` | **Medium** |
| `cluster_diff` | `cluster-diff` | **Medium** |
| `cluster_timeline` | `cluster-timeline` | **Medium** |
| `cluster_change_points` | `cluster-change-points` | Low |
| `status` | `status` | Low |

**Missing flag parity on existing MCP tools:**
- `semantic_search`: missing `hybrid`, `vss`, `chunks`, `group`, `level`, `annotate-clusters`, `include-commits`, `branch`, `model`.
- `first_seen`: missing `hybrid`, `branch`, `include-commits`, `model`.
- `evolution`: missing `model`.
- `concept_evolution`: missing `branch`, `model`.
- `index`: missing `model`, `quantize`, `chunker` details.
- `author`: missing `hybrid`, `branch`.

### 1.11 HTTP Route Coverage

**16 routes present.** Key missing CLI command equivalents:

| Missing Route | CLI Command | Priority |
|--------------|-------------|----------|
| `POST /analysis/semantic-diff` | `semantic-diff` | **High** |
| `POST /analysis/semantic-blame` | `semantic-blame` | **High** |
| `POST /analysis/dead-concepts` | `dead-concepts` | **High** |
| `POST /analysis/merge-audit` | `merge-audit` | Medium |
| `POST /analysis/merge-preview` | `merge-preview` | Medium |
| `POST /analysis/branch-summary` | `branch-summary` | Medium |

**Missing flag parity on existing HTTP routes:**
- `POST /search`: missing `vss`, `level`, `include-commits`, `model`.
- `POST /search/first-seen`: missing `hybrid`, `branch`, `include-commits`, `model`.

### 1.12 Infrastructure Patterns

**Commands duplicating search logic instead of using shared infrastructure:**

| Command | Issue |
|---------|-------|
| `impact` | Loads ALL embeddings, manually iterates + scores with `cosineSimilarity()` instead of `vectorSearch()` |
| `semantic-blame` | Embeds each chunk separately via `provider.embed()`, manually scores against all DB embeddings |
| `semantic-diff` | Manually loads embeddings per ref, scores via `cosineSimilarity()` |

All commands use `embedQuery()` and `providerFactory.ts` where justified — no unjustified infrastructure bypasses found.

### 1.13 Complete Gap Matrix

| Feature | search | author | first-seen | impact | sem-diff | sem-blame | change-pts | concept-evo | diff | evolution | MCP search | HTTP search |
|---------|:------:|:------:|:----------:|:------:|:--------:|:---------:|:----------:|:-----------:|:----:|:---------:|:----------:|:-----------:|
| `--hybrid` | ✅ | ✅ | ✅ | — | ❌🔴 | — | ❌🔴 | ❌🟡 | — | — | ❌🔴 | ✅ |
| `--branch` | ✅ | ✅ | ✅ | ✅ | ❌🟡 | ❌🔴 | ✅ | ✅ | — | ❌🟡 | ❌🔴 | — |
| `--html` | ❌🟢 | ❌🟢 | ❌🟢 | ❌🟢 | ❌🟡 | — | ✅ | ✅ | — | ✅ | — | — |
| `--dump` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌🟡 | ✅ | — | — |
| `--vss` | ✅ | ❌🟢 | ❌🟢 | — | — | — | — | — | — | — | — | ❌🟡 |
| `--model` | ✅ | ❌🔴 | ✅ | ❌🔴 | ✅ | ❌🔴 | ❌🔴 | ✅ | — | ✅ | ❌🔴 | ❌🟡 |
| `--include-commits` | ✅ | ❌🟡 | ✅ | — | — | — | — | — | — | — | ❌🟡 | ❌🟡 |
| `--chunks` | ✅ | ❌🟡 | ❌🟡 | ✅ | — | — | — | — | — | — | ❌🔴 | ✅ |
| `--level` | ✅ | ❌🟡 | ❌🟡 | ✅ | — | ✅ | — | — | — | ✅ | ❌🔴 | ❌🟡 |

**Legend**: ✅ Supported · ❌🔴 Missing (Critical) · ❌🟡 Missing (Important) · ❌🟢 Missing (Nice-to-have) · — N/A

---

## Part 2 — Performance

### Summary

7 critical, 9 high-severity, and 12 medium-severity performance issues identified. The most impactful: **(1)** full-table embedding scans loading all vectors into memory, **(2)** missing database indexes on frequently-joined columns, **(3)** redundant `Array.from(Float32Array)` copies on every vector operation. At 100K+ indexed blobs these compound to multi-GB memory peaks and 10× slower search.

### Critical (P0)

#### C1. Full-table embedding scan on every query

**Files:** `vectorSearch.ts`, `impact.ts`, `deadConcepts.ts`, `clustering.ts`

Every search/impact/clustering query loads ALL embedding rows into JS heap via `.all()`. At 100K embeddings × 384 dimensions × 8 bytes/element (V8 number[]) = ~300 MB per query. With chunks + symbols enabled, this triples. At 1M embeddings → 3+ GB peak memory.

**Recommendation:**
- Short term: push branch/model filters into SQL `WHERE` clauses instead of post-load filtering.
- Medium term: use the usearch HNSW index for sub-linear search.
- Long term: dedicated vector store for repos >50K blobs.

#### C2. Missing database indexes

Only 2 indexes exist in the entire database (`idx_commits_timestamp`, `idx_module_embeddings_path_model`). Six critical indexes are missing:

```sql
CREATE INDEX idx_paths_blob_hash ON paths(blob_hash);
CREATE INDEX idx_paths_path ON paths(path);
CREATE INDEX idx_symbols_blob_hash ON symbols(blob_hash);
CREATE INDEX idx_chunks_blob_hash ON chunks(blob_hash);
CREATE INDEX idx_blob_commits_blob_hash ON blob_commits(blob_hash);
CREATE INDEX idx_blob_branches_branch_name ON blob_branches(branch_name);
```

These columns are queried via `WHERE`/`JOIN`/`IN` in vectorSearch, impact, deadConcepts, clustering, timeSearch, and evolution. For 100K rows, a full table scan is ~1000× slower than an indexed lookup. Path resolution runs on every search result (up to hundreds of blobs).

#### C3. `Array.from(Float32Array)` copies on every embedding access

**Files:** `vectorSearch.ts:28-31`, `deadConcepts.ts:46-48`, `quantize.ts:30`, `queryCache.ts:26-27`

Each call allocates a new `number[]` (8 bytes/element) from a `Float32Array` (4 bytes/element). For 384-dim embeddings: 3 KB → 6 KB per embedding. With 100K candidates: 600 MB of temporary allocations.

**Fix:** Change `Embedding` type to `Float32Array` throughout. `cosineSimilarity` works unchanged on typed arrays. Halves memory and eliminates the copy.

#### C4. Full path table scan in `impact.ts`

```typescript
const pathRows = db.select({...}).from(paths).all()  // loads ALL path rows
```

Loads the entire `paths` table for one matching path via string comparison in a loop. For 100K paths: ~10 MB of unnecessary data.

**Fix:** Use a SQL `WHERE` clause: `.where(eq(paths.path, normalised))`.

#### C5. Branch filter applied AFTER full embedding load

**Files:** `impact.ts`, `deadConcepts.ts`

Both load every embedding row and then filter by branch in JavaScript. The entire embedding table is deserialized before the branch filter removes most rows.

**Fix:** SQL subquery: `WHERE e.blob_hash IN (SELECT blob_hash FROM blob_branches WHERE branch_name = ?)`.

#### C6. Unused `embedBatch()` API in indexer

The indexer always calls `provider.embed(text)` one blob at a time. `HttpProvider.embedBatch()` exists and sends all texts in one HTTP request but is never called. For 1000 blobs at ~50ms per HTTP call: 50 seconds of network overhead vs. ~5 seconds if batched 100-at-a-time.

#### C7. Module embedding N+1 pattern during indexing

For every blob indexed, the indexer does 2 extra DB queries (read + write module embedding). For 1000 blobs in 50 directories: 2000 DB operations.

**Fix:** Accumulate module vectors in a `Map<string, {sum, count}>` in memory during indexing, flush all in one batch transaction at the end.

### High (P1)

#### H1. Two-pass min/max with spread operator in quantization

```typescript
const min = Math.min(...vector)  // O(n) + spread
const max = Math.max(...vector)  // O(n) second pass
```

Spread operator creates a 384-element argument list on the call stack. Risk of stack overflow at high dimensions. Two passes when one suffices.

**Fix:** Single-pass manual loop.

#### H2. `indexOf()` in clustering hot loop — O(n²×k)

```typescript
const idx = inputHashes.indexOf(h)  // O(n) linear scan per blob
```

For 10K blobs across 8 clusters: ~12.5M string comparisons.

**Fix:** `const hashIndex = new Map(inputHashes.map((h, i) => [h, i]))` — O(1) lookup.

#### H3. Per-cluster SQL queries with dynamic placeholder strings

For each of k clusters, 3 separate SQL queries are executed. For k=8: 24 DB queries per clustering run. With 1000+ blob clusters, placeholder strings can exceed 5KB.

#### H4. `dequantizeVector()` called per-candidate during scoring

Every quantized candidate allocates a fresh `number[]` of 384 elements. With 100K candidates: 300MB of temporary arrays.

**Fix:** Perform cosine similarity directly on quantized `Int8Array` with pre-computed scale factors.

#### H5. Two git subprocess calls per blob in `showBlob.ts`

Every blob fetches size first (`cat-file -s`), then content (`cat-file blob`). Process spawning overhead: ~1-5ms per fork. For 10K blobs: 10-50 seconds of pure spawning overhead.

**Fix:** Use `git cat-file --batch` with a long-running subprocess.

#### H6. Deduplication after scoring instead of before

Cosine similarity runs on the full undeduped pool (all chunks/symbols for same blob), then deduplicates keeping only best score. With chunks + symbols: 16× multiplier on scoring work.

**Fix:** Pre-deduplicate by blob hash before scoring.

#### H7. Temporal clustering runs full cold-start k-means per timestamp

`computeClusterTimeline()` runs full k-means from scratch for each sampled timestamp. For 5 steps × 50K blobs: ~30 billion float operations.

**Fix:** Warm-start each timestep with previous centroids. Converges in 2-3 iterations instead of 20 → ~7× speedup.

#### H8. `cosineSimilarity` re-computes query norm on every candidate

The query embedding's magnitude is recomputed for every candidate. For 100K candidates: 100K redundant norm computations.

**Fix:** Pre-compute `||query||` once before the loop.

#### H9. Per-blob FTS5 insert via delete+insert pair

Each blob's FTS content: individual delete then insert. For 10K blobs: 20K SQL operations.

**Fix:** Batch within the same transaction.

### Medium (P2)

| # | Issue | Impact |
|---|-------|--------|
| M1 | `seenHashes` Set grows unbounded for large histories (1M+ blobs) | Memory |
| M2 | Object spread in scoring loops creates garbage (200K temp objects for 100K candidates) | GC pressure |
| M3 | Progress callback on every blob during concurrent processing | UI bottleneck |
| M4 | `updateModulesCommand` deletes all module embeddings then reinserts | Wasteful for incremental |
| M5 | Clustering FTS content joined into single 5MB+ string for keyword extraction | Memory |
| M6 | Query cache TTL only checked during explicit prune, not on read | Stale entries |
| M7 | `mergeSearchResults` spreads both arrays into intermediate combined array | Allocation |
| M8 | `assignClusters()` uses `push()` instead of pre-sized array | Resizing |
| M9 | Clustering persistence uses individual INSERTs per blob | Batch opportunity |
| M10 | `computeRecencyScores()` uses two-pass min/max | Same as H1 |
| M11 | `kMeansInit` inner `centroids.some()` has O(k×d) element-wise equality | Edge case |
| M12 | Hybrid search min/max normalization uses two passes with spread | Same as H1 |

### Impact Estimates

| Issue | Memory | Latency | Threshold |
|-------|--------|---------|-----------|
| C1 Full table scan | 300MB–3GB | 2-10× slower | >10K blobs |
| C2 Missing indexes | — | 10-100× slower path resolution | >5K paths |
| C3 Array.from copies | 2× heap | 30-50% slower scoring | All |
| C4 Path table scan | 10MB+ | Seconds per impact query | >10K paths |
| C5 Post-load branch filter | 100-300MB | — | Branch queries |
| C6 No batch embedding | — | 5-10× slower indexing (HTTP) | HTTP providers |
| H2 indexOf in clustering | — | 10× slower clustering | >1K blobs |
| H5 Double git spawn | — | 10-50s per 10K blobs | Indexing |
| H7 Cold-start k-means | — | 7× slower timeline | Timeline commands |

### Top 5 Quick Wins (Highest ROI, Lowest Risk)

1. **Add 6 missing indexes** (C2) — 6 `CREATE INDEX` statements in a migration. Zero risk, dramatic query speedup.
2. **Pre-compute query norm** (H8) — Normalize query embedding once before scoring loop. ~50% fewer float ops per candidate.
3. **Replace `indexOf` with Map in clustering** (H2) — 3-line fix. 1000× speedup for that loop.
4. **Single-pass min/max in quantize.ts** (H1) — 5-line fix. Eliminates spread operator risk.
5. **Push branch filter into SQL** (C5) — Change one query to use a subquery. Eliminates loading unneeded embeddings.

---

## Part 3 — Next Steps

### Priority Matrix (Top 10 by Value/Effort)

| Rank | Feature | Complexity | Value | Category |
|------|---------|-----------|-------|----------|
| 🥇 | Code-to-Code Search | Low | High | Search |
| 🥈 | Negative Examples Search | Low | High | Search |
| 🥉 | Result Explanation | Low-Med | High | Search |
| 4 | Semantic Git Bisect | Medium | High | Temporal |
| 5 | Garbage Collection | Medium | Med-High | Infrastructure |
| 6 | Refactoring Suggestions | Medium | High | Analysis |
| 7 | Boolean/Composite Queries | Medium | High | Search |
| 8 | CI/CD Semantic Diff in PRs | Medium | High | Integration |
| 9 | Concept Lifecycle Analysis | Medium | High | Temporal |
| 10 | Documentation Gap Analysis | Low-Med | Med-High | Analysis |

### Category 1: Query & Search Enhancements

#### 1.1 Code-to-Code Search 🥇

Embed a code snippet and find similar code in the index.

- **Leverages:** `providerFactory.getCodeProvider()`, `vectorSearch()` with `searchSymbols=true`, `symbols` table metadata, `blob_fts` for content retrieval, `blobCommits` for provenance.
- **Complexity: Low** — The system already embeds symbols/chunks and searches them. Primarily an API/CLI surface change: accept code input instead of natural language and force symbol/chunk-level search with the code model.
- **Why it matters:** The most direct use-case for code embeddings. Finds duplicates, canonical implementations, and similar patterns across entire Git history — including deleted code.
- **Implementation:** `gitsema code-search --snippet "function foo(x) { return x * 2 }" --level symbol` → use code provider, run `vectorSearch()` with symbol/chunk levels, enrich with provenance.

#### 1.2 Negative Examples Search 🥈

"Find code like X but not like Y."

- **Leverages:** `embedQuery()` with caching for both exemplars, `cosineSimilarity()`, all temporal/branch filters.
- **Complexity: Low-Medium** — Scoring arithmetic is trivial: `cos(pos, doc) - λ·cos(neg, doc)`. Main work is integrating with three-signal ranking and hybrid BM25.
- **Why it matters:** Maps naturally to migration intent ("find code still using old auth pattern, not the new one"). Uniquely powerful with temporal filters.
- **Implementation:** `gitsema search --like "async/await" --not-like "callback hell" --lambda 0.8` → embed both, score with contrastive formula, apply three-signal ranking.

#### 1.3 Result Explanation 🥉

"Why was this result returned?"

- **Leverages:** Cosine similarity and path relevance scores already computed in `vectorSearch.ts`, hybrid BM25 scores, `cluster_assignments` for cluster context.
- **Complexity: Low-Medium** — Most data is already computed; this is packaging and exposing it.
- **Why it matters:** Developers need to trust semantic results. Transparency increases adoption.
- **Implementation:** Extend `SearchResult` with `signals: { vector: { score, weight, contribution }, bm25?: ..., recency?: ..., path: { matchedTokens, score } }`. Add `--explain` flag.

#### 1.4 Boolean/Composite Queries

AND/OR/NOT over embedding result sets.

- **Leverages:** `embedQuery()` cache, `vectorSearch()` per query, `mergeSearchResults()`.
- **Complexity: Medium** — Set algebra is straightforward; combined ranking is the challenge.
- **Implementation:** Parse composite query into AST → per-atomic `vectorSearch()` → AND=intersection (harmonic mean), OR=union (max), NOT=exclusion → re-rank.

#### 1.5 Query Expansion

Automatically expand queries using repository-specific signals.

- **Leverages:** `extractRichTokens()` and `splitIdentifier()` from `labelEnhancer.ts`, cluster keywords, `blob_fts`.
- **Complexity: Medium** — Local rule-based expansion is low effort.
- **Implementation:** Identifier splitting + cluster keyword injection → expanded BM25 terms + original embedding.

#### 1.6 Cross-Repository Search

Search across multiple indexed repos with a single query.

- **Leverages:** MCP/HTTP API for aggregation, per-repo SQLite DBs, `mergeSearchResults()`.
- **Complexity: Medium-High** (federated MVP is Medium).
- **Implementation:** `gitsema search-multi --repos ./repo1,./repo2 --query "auth"` → search each DB, tag results with repo_id, merge.

#### 1.7 Saved Searches / Watch Queries

Notify when new matches appear after incremental indexing.

- **Leverages:** `embedQuery()`, `filterByTimeRange()` with high-water mark, `indexed_commits`.
- **Complexity: Medium** — Scheduling + notification plumbing.
- **Implementation:** New `saved_queries` table. `gitsema watch add "deprecated API" --webhook URL` → periodic search with `after=last_run_ts`, notify on new matches.

### Category 2: Analysis & Intelligence

#### 2.1 Refactoring Suggestions

Detect semantically similar code that should be unified.

- **Leverages:** `symbolEmbeddings` + `chunkEmbeddings` for fine-grained similarity, `commits` for duplication age, `computeAuthorContributions()` for ownership, `computeImpact()` for coupling risk.
- **Complexity: Medium** — Candidate detection via NN is straightforward; safe ranking requires integrating multiple signals.
- **Why uniquely gitsema:** Detects duplicates across renames and obfuscation; Git history provides provenance.
- **Implementation:** `gitsema refactor-candidates --threshold 0.88 --level symbol` → NN per symbol → group high-similarity pairs → rank by similarity × age × churn × coupling.

#### 2.2 Documentation Gap Analysis

Concepts with code but no docs.

- **Leverages:** `fileType.ts` routing (code vs text), embeddings for both, `blob_clusters` for concept grouping, `computeImpact()` for importance.
- **Complexity: Low-Medium**
- **Implementation:** Partition blobs into code vs doc → for each public symbol, find nearest doc embedding → if distance > threshold AND no FTS5 mention → gap. Rank by impact × churn.

#### 2.3 Test Coverage Semantic Analysis

Which semantic regions lack tests?

- **Leverages:** File category routing, `chunkEmbeddings`, `blob_clusters`, `computeImpact()`, commit history.
- **Complexity: Medium**
- **Implementation:** Label test vs code files by path patterns → for each code cluster, find nearest test embeddings → coverage = fraction of code chunks with a test within threshold → rank uncovered by impact × churn.

#### 2.4 API Surface Evolution

Track public API changes semantically over time.

- **Leverages:** `symbols` table, `symbolEmbeddings`, `computeEvolution()`, `computeImpact()`, temporal cluster diffs.
- **Complexity: Medium**
- **Why uniquely gitsema:** Detects renames even when names change completely via embedding similarity across time.

#### 2.5 Security Pattern Detection

Find code semantically similar to known vulnerable patterns.

- **Leverages:** `chunkEmbeddings`, `blob_fts`, `computeSemanticBlame()`, temporal tracking.
- **Complexity: High** — Requires curated vulnerability corpus.
- **Why uniquely gitsema:** History traces origins and remediation.

#### 2.6 Code Complexity Scoring

Semantic complexity = α·distance_to_centroid + β·intra_file_variance + γ·temporal_instability + δ·coupling_score.

- **Leverages:** `chunkEmbeddings` + `blob_clusters` for dispersion, `computeEvolution()` for drift, `computeImpact()` for coupling.
- **Complexity: Low-Medium**

### Category 3: Temporal & Historical

#### 3.1 Semantic Git Bisect

Find the commit where a concept changed most. Binary search over commit history using semantic distance.

- **Leverages:** `commits` + `blobCommits`, `getBlobHashesUpTo()`, `computeConceptChangePoints()`, `resolveRefToTimestamp()`.
- **Complexity: Medium** — Building blocks exist; binary search over commits with per-commit centroid is the main work.
- **Why uniquely gitsema:** `git bisect` requires a pass/fail test; semantic bisect works on concepts.
- **Implementation:** `gitsema bisect --query "auth flow" --good v1.0 --bad HEAD` → binary search → at midpoint compute concept centroid → measure distance from "good" centroid → choose side with larger change → O(log N) centroid computations.

#### 3.2 Concept Lifecycle Analysis

Birth → Growth → Maturity → Decay of concepts.

- **Leverages:** `getFirstSeenMap()` for birth, `commits` + `blobCommits` for growth rate, cluster timeline for size, `findDeadConcepts()` for death, `computeAuthorContributions()` for contributors.
- **Complexity: Medium** — Time-series segmentation with threshold heuristics.
- **Implementation:** Extract blob count per concept per time window → compute growth rate → identify stages via rate thresholds → use change-point detection for boundaries.

#### 3.3 Contributor Semantic Profiles

What kinds of code does each author write?

- **Leverages:** `commits.author_name/email`, `blobCommits`, `cluster_assignments`, `getFirstSeenMap()`.
- **Complexity: Medium** — Primarily aggregation.
- **Implementation:** `gitsema author-profile <email>` → query commits by author → expand to blobs → map to clusters → compute top clusters, introduction count, maintenance ratio, temporal heatmap.

#### 3.4 Codebase Health Timeline

Diversity, complexity, coupling over time.

- **Leverages:** Cluster timeline, `commits`, temporal cluster diffs, `getBlobHashesUpTo()`.
- **Complexity: High**

#### 3.5 Technical Debt Scoring

Semantic distance from "clean" patterns.

- **Leverages:** `blob_clusters` centroids, `embeddings`, `commits`, `computeImpact()`.
- **Complexity: High** — Defining "clean" patterns is subjective.

### Category 4: Integration & Workflow

#### 4.1 CI/CD Semantic Diff in PRs

Semantic diff as PR comment/check.

- **Leverages:** `computeSemanticDiff()`, `computeImpact()`, `--dump` JSON, HTML renderers.
- **Complexity: Medium** — Core logic exists; CI/GitHub API integration is the work.
- **Implementation:** `gitsema ci-diff --base $BASE --head $HEAD --format html` → GitHub Action posts as PR comment.

#### 4.2 Semantic Cherry-Pick Suggestions

Given a commit to cherry-pick, suggest semantically-related commits.

- **Leverages:** `commitEmbeddings`, `vectorSearch`, `getBranchExclusiveBlobs()`, `moduleEmbeddings`.
- **Complexity: Medium**
- **Implementation:** Embed commit → query `commitEmbeddings` for NN → filter out commits already on target → rank by similarity + file overlap + module overlap.

#### 4.3 IDE / LSP Integration

VS Code extension or LSP server exposing semantic search, blame, exploration.

- **Leverages:** All search/analysis functions, HNSW index, MCP protocol.
- **Complexity: High**

### Category 5: Export & Visualization

#### 5.1 Semantic Codebase Map

Interactive 2D UMAP/t-SNE projection of embeddings with temporal animation.

- **Leverages:** Stored embeddings, `moduleEmbeddings`, HTML renderers, `blob_clusters`, `blobCommits`.
- **Complexity: Medium-High**
- **Implementation:** Extract embeddings → UMAP to 2D → store coordinates → render interactive HTML with pan/zoom, cluster coloring, click-to-drill, temporal slider.

#### 5.2 Temporal Heatmap

Rows = semantic concepts/clusters, columns = time buckets, cell color = activity intensity.

- **Leverages:** `commits`, cluster timeline, `blob_clusters`, HTML renderers.
- **Complexity: Medium**

#### 5.3 Embedding Space Explorer

Interactive web UI for browsing the embedding space.

- **Leverages:** HTTP API, HNSW index, SQLite, HTML renderers.
- **Complexity: Medium**

### Category 6: Infrastructure & Scale

#### 6.1 Garbage Collection

Remove embeddings for files/commits no longer reachable from any ref.

- **Leverages:** `commits` + `blobCommits`, `git rev-list --all`, batch processing.
- **Complexity: Medium**
- **Implementation:** `gitsema gc --dry-run --keep-days 90` → compute reachable blob set → batch-delete unreachable from all tables → rebuild HNSW if needed.

#### 6.2 Partial/Selective Indexing (Globs)

Include/exclude glob patterns in config so indexing processes only a subset.

- **Leverages:** Existing extension filtering in `revList()`, config management.
- **Complexity: Low**
- **Why it matters:** Critical for monorepos. Avoids indexing costs for irrelevant files.
- **Implementation:** Config: `{ "include": ["src/**"], "exclude": ["vendor/**"] }`. Modify `revList`/walker to apply glob filters.

#### 6.3 Remote Index Sharing

Share a built index as compressed artifact or via index server.

- **Leverages:** SQLite (single-file), HNSW index files, HTTP API + auth, multi-model keys.
- **Complexity: Medium-High**
- **Implementation:** `gitsema export-index --out bundle.tar.gz` / `gitsema import-index --in bundle.tar.gz`.

#### 6.4 Multi-Repo Unified Index

Workspace-level unified index for cross-repo semantic search.

- **Leverages:** Multi-model DB composite keys, `mergeSearchResults()`, HTTP API.
- **Complexity: High**

### Cross-Cutting Observations

**Fix existing gaps before building new features:**
1. Missing MCP tools — 8 commands lack MCP equivalents.
2. Missing `--model` flags — 4 commands embed queries without model selection.
3. Missing `--branch` flags — 4 analysis commands lack branch scoping.
4. Missing HTTP routes — 6 analysis commands lack API equivalents.
5. Missing `--html` on 4 search/analysis commands that would benefit.

**Architectural recommendations:**
1. **`SearchPipeline` abstraction** — composable features (boolean queries → expansion → explanation → saved queries) without duplicating scoring logic.
2. **`concept_snapshot` table** — cache per-commit concept centroids. Enables semantic bisect, lifecycle analysis, and health timeline without recomputing.
3. **`FeatureFlags` system** — config-based toggles for gradually rollable features.

### Recommended Implementation Order

```
Phase 37: Quick Wins (1-2 days each)
  - Code-to-Code Search (Low complexity, High value)
  - Negative Examples Search (Low complexity, High value)
  - Partial/Selective Indexing (Low complexity, High value)
  - Result Explanation (Low-Med complexity, High value)

Phase 38: Medium Effort, High Impact (3-5 days each)
  - Semantic Git Bisect
  - Garbage Collection
  - Boolean/Composite Queries
  - Documentation Gap Analysis

Phase 39: Analysis Features (1-2 weeks each)
  - Refactoring Suggestions
  - Concept Lifecycle Analysis
  - Contributor Semantic Profiles
  - CI/CD Semantic Diff in PRs

Phase 40: Visualization & Scale (2-4 weeks each)
  - Semantic Codebase Map (UMAP/t-SNE)
  - Temporal Heatmap
  - Remote Index Sharing
  - Semantic Cherry-Pick Suggestions

Phase 41+: Large Investments (4+ weeks each)
  - Multi-Repo Unified Index
  - IDE / LSP Integration
  - Security Pattern Detection
  - Codebase Health Timeline
  - Technical Debt Scoring
```
