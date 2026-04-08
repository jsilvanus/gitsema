# Code Review 6 — Architecture Maturity, Scale Readiness, and Remaining Gaps

This review builds on:

- `docs/review.md` through `docs/review5.md`

It reflects the repository state at **v0.83.0** (schema v19, 695 tests across 59 test files, 166 TypeScript source files, ~34K LOC in `src/`, ~10K LOC in `tests/`).

---

## 1) Executive Summary

All twelve proposals from review5 are now shipped (Phases 71–84). Since v0.70.0, gitsema has added: operational readiness primitives (Prometheus `/metrics`, rate limiting, OpenAPI spec generation), full HTTP route parity for all analysis commands, deployment documentation with Docker infrastructure, per-repo access control, HTML renderer modularization, unified indexing/search level concept, auto-cap search memory, parallel commit-message embedding, and working LSP definition/references/documentSymbol handlers.

The tool is now at **v0.83.0** with **57+ CLI commands**, **25+ MCP tools**, **30+ HTTP routes**, **~695 tests**, and a schema at **v19**. The velocity since review5 is impressive — 13 minor versions shipped.

The remaining gaps fall into five categories:

1. **Test suite health** — 8 of 695 tests fail on Windows (EPERM temp-dir cleanup, path separator mismatches, stale fixture assumptions). CI may mask this if run on Linux only.
2. **Search at scale** — auto-cap (Phase 82) is a good default, but the fundamental O(n) candidate materialization still loads all embedding rows into JS memory before sampling. SQL-level filtering remains unimplemented.
3. **MCP server monolith** — `server.ts` is 1,542 lines with 25+ tool registrations following identical patterns. This is the largest maintainability liability.
4. **Error handling gaps** — no retry/backoff on embedding provider failures, no backpressure in the async pipeline queue, and broad catch blocks that swallow real errors.
5. **Database integrity** — missing cascade deletes, no unique constraint on `(blob_hash, path)`, FTS5 content stored outside the main transaction, and growing unbounded caches.

None of these are blockers for single-user or small-team use. They become material at scale (>50K blobs, shared server deployments, CI integration).

---

## 2) Review5 Proposals — Disposition

| # | Proposal | Status | Phase | Notes |
|---|---|---|---|---|
| 1 | HTTP routes for Phase 41–70 commands | ✅ Shipped | 72 | All 10 analysis routes added |
| 2 | OpenAPI spec from Zod schemas | ✅ Shipped | 71 | `GET /openapi.json` + Swagger UI at `/docs` |
| 3 | `/metrics` Prometheus endpoint | ✅ Shipped | 71 | Latency histograms, index gauges, cache hit ratio |
| 4 | Rate limiting middleware | ✅ Shipped | 71 | Per-token/per-IP with `Retry-After` header |
| 5 | `gitsema status` scale warnings | ✅ Shipped | 74 | VSS staleness, blob count warnings |
| 6 | HNSW for general search | ✅ Shipped | 82 | Auto-cap at 50K + `vectorSearchWithAnn()` routing |
| 7 | Deployment guide + Docker image | ✅ Shipped | 73 | `docs/deploy.md`, `Dockerfile`, `docker-compose.yml` |
| 8 | Short-TTL result cache | ✅ Shipped | — | `resultCache.ts` with 60s TTL + version invalidation |
| 9 | `gitsema doctor` extended pre-flight | ✅ Shipped | 74 | Provider reachability, index freshness, latency class |
| 10 | `SearchResult` discriminated union types | ⚠️ Partial | — | `SearchResultKind` enum added, but optional fields remain; no true discriminated union |
| 11 | LSP go-to-definition + find-references | ✅ Shipped | 84 | Four-tier definition, FTS5+symbol references, documentSymbol |
| 12 | Per-repo access control on HTTP server | ✅ Shipped | 75 | `repo_tokens` table, scoped auth middleware |

**Result: 11 of 12 fully shipped; 1 partial.**

---

## 3) Test Suite Health

### 3.1 Current state: 687 pass, 8 fail (59 test files)

| Failure Class | Count | Root Cause |
|---|---|---|
| **EPERM on temp dir cleanup** | 6 | `rmSync(tmpDir, { recursive: true })` in `afterAll` fails on Windows when SQLite still holds file handles. Tests themselves pass — the assertion error is in cleanup. |
| **Path separator mismatch** | 1 | `config.test.ts` asserts `/some/repo/.gitsema/config.json` but gets `\some\repo\.gitsema\config.json` on Windows. Unix-only path expectation. |
| **Stale fixture assumption** | 1 | `annSearch.test.ts` expects `getVssIndexPaths()` to return `null` when index files don't exist, but the test runs in a directory where a real `.gitsema/` folder exists with VSS index files from a prior run. Environment-dependent. |

**All 8 failures are environment-specific, not logic bugs.** On Linux CI they likely pass. However, this indicates:

1. **No Windows CI matrix** — the CI workflow runs Node 20 on a single OS. Adding `os: [ubuntu-latest, windows-latest]` would catch these.
2. **Temp directory cleanup is fragile** — SQLite file handles prevent deletion on Windows. Tests should close DB connections explicitly before `rmSync`.
3. **Tests depend on workspace purity** — `annSearch.test.ts` fails when run from a workspace that has its own `.gitsema/` index. Tests should use isolated temp directories for all DB operations.

### 3.2 Coverage gaps

| Area | Test Files | Depth | Gap |
|---|---|---|---|
| Core indexing pipeline | 5 (integration, indexProgress, pipelinedIndexer, provenance, adaptiveTuning) | Good | No test for resume-after-crash (partial indexing) |
| Vector/hybrid search | 3 (vectorSearch, ranking, annSearch) | Good | No test for auto-cap behavior at 50K+ entries |
| Temporal (evolution, bisect, first-seen) | 3 (evolution, changePoints, semanticBlame) | Good | — |
| Clustering | 4 (clustering, clusterDiff, clusterTimeline, clusterChangePoints) | Good | — |
| HTTP API | 2 (serverRoutes, httpParityTests) | Moderate | No E2E with real DB + real embedding mock |
| MCP tools | 2 (mcpTools, mcpParityTests) | Moderate | No transport-level or error-path tests |
| Embedding providers | 1 (providerFailures) | Minimal | No timeout, rate-limit, or partial-batch tests |
| LSP | 1 (lsp) | Minimal | Only 4 tests; no definition/references tests for Phase 84 |
| Config | 1 (config) | Minimal | Path separator issue; no global vs. local precedence test |
| Security scan | 1 (securityScan) | Moderate | — |
| LLM narrator | 0 | **None** | No tests for any narration functions |
| HTML renderers | 1 (htmlRenderer) | Minimal | Only basic smoke test |

**Highest-leverage additions:** (1) LSP definition/references tests for Phase 84 features, (2) embedding provider failure mode tests, (3) LLM narrator unit tests.

---

## 4) Architecture Assessment

### 4.1 Strengths

**Content-addressed design is sound.** The blob-hash-first model delivers genuine deduplication, immutable embeddings, and clean temporal queries. This is the project's core differentiator and it's implemented consistently across all 19 schema tables.

**Three-surface parity.** CLI, MCP, and HTTP all route through the same core functions. The parity test suites (`mcpParityTests`, `httpParityTests`) enforce this. This is excellent engineering discipline.

**Module isolation.** The 31 search modules in `src/core/search/` are well-scoped — most are 75–350 lines, single-purpose, and independently testable. The chunking, embedding, and Git modules follow the same pattern.

**Operational readiness (new since review5).** Prometheus metrics, rate limiting, OpenAPI spec, deployment guide, and per-repo access control address the most critical gaps identified in review5. The HTTP server is now deployable as a shared service.

**Config system.** Three-tier precedence (env vars > local config > global config) with 30+ configurable keys is well-designed. The `gitsema config list` command shows values and their sources — excellent for debugging.

### 4.2 Structural liabilities

#### 4.2.1 MCP `server.ts` — 1,542 lines, 25+ tools

Every tool follows the same pattern:
```typescript
server.tool('name', 'description', { zod schema }, async ({ params }) => {
  try {
    const embedding = await embedQuery(params.query)
    const results = await coreFunction(embedding, ...)
    return { content: [{ type: 'text', text: formatResults(results) }] }
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${msg}` }] }
  }
})
```

This is the single largest file in the project (excluding CLI index.ts at 1,593 lines) and the most repetitive. Extracting a `registerTool(name, schema, handler)` pattern and splitting by domain (search, analysis, clustering, workflow) would reduce this to 5–6 files of ~250 lines each.

#### 4.2.2 CLI `index.ts` — 1,593 lines

The CLI entry point registers 57+ commands with Commander.js. Each registration is 15–30 lines of option definitions. While structurally sound, navigating 1,593 lines to find a specific command's option set is painful. Consider splitting command registration into domain-grouped files similar to how `commands/*.ts` already splits handlers.

#### 4.2.3 `analysis.ts` route file — 805 lines

The HTTP analysis routes file combines 15+ endpoints into a single file. Same recommendation as MCP: split by domain.

#### 4.2.4 `clustering.ts` — 1,334 lines

The largest search module. Contains K-means, cluster snapshots, cluster diff, cluster timeline, cluster change-points, and label generation all in one file. This would benefit from splitting into `clustering/kmeans.ts`, `clustering/diff.ts`, `clustering/timeline.ts`.

#### 4.2.5 `src/core/search/` — 31 files in a flat directory

No subdirectory organization. Finding a specific module requires remembering its name. Grouping into `search/temporal/`, `search/analysis/`, `search/clustering/`, `search/quality/` would improve navigability without changing any import paths (re-exports from a barrel at the `search/` level).

### 4.3 Data flow correctness

The indexing pipeline is correct and has been stable since the early phases:

```
Git walker (streaming) → dedup → embed → transactional store → commit-map → module centroids
```

The search pipeline is also correct:

```
Query → embed (cached) → candidate pool → cosine/ANN → optional hybrid (BM25) → rank → group → format
```

**Phase 82's auto-cap** makes search safe-by-default on large indexes by reservoir-sampling at 50K candidates. This was the most important fix since review5.

**Phase 83's parallel commit embedding** eliminates the serial commit-mapping bottleneck identified in review5 §2.3.

---

## 5) Performance Analysis

### 5.1 Resolved since review5

| Issue (review5) | Resolution | Phase |
|---|---|---|
| §2.1 Full candidate materialization | Auto-cap at 50K via reservoir sampling | 82 |
| §2.3 Serial commit-mapping | Parallel p-limit fan-out of commit embeddings | 83 |
| §2.4 Path resolution per result | `hybridSearch` batches in 500-item chunks (review5 noted) | — |

### 5.2 Outstanding bottlenecks

#### 5.2.1 Candidate pool still loaded entirely into JS memory

`vectorSearch.ts` calls `db.select().from(embeddings).all()` to load ALL embedding rows before applying time filters, branch filters, or early-cut. The reservoir sample (Phase 82) reduces the scoring pool but not the memory allocation. For 100K blobs at 768-dim float32, this is ~300 MB of temporary allocations before sampling.

**Fix:** Apply filters at the SQL level:
```sql
SELECT e.* FROM embeddings e
  JOIN blobs b ON e.blob_hash = b.blob_hash
  WHERE e.model = ?
  AND (? IS NULL OR b.indexed_at < ?)  -- time filter
  AND (? IS NULL OR e.blob_hash IN (SELECT blob_hash FROM blob_branches WHERE branch_name = ?))
ORDER BY RANDOM() LIMIT 50000  -- reservoir sample in SQL
```

This would reduce memory from O(total_blobs × dim) to O(sample_size × dim).

#### 5.2.2 Per-blob `isIndexed()` queries in local indexer

The local indexer calls `isIndexed(blobHash, model)` individually for every blob encountered during the Git walk. This generates N SQLite round-trips where N is the total number of blobs seen. The remote indexer correctly uses `filterNewBlobs()` for batch checking. The local indexer should do the same — batch-check in groups of 500 instead of per-blob queries.

#### 5.2.3 `computeDiff()` and `findNeighbors()` load all embeddings

Both functions in `evolution.ts` call `db.select().from(embeddings).all()` with no filters. `findNeighbors()` then computes cosine similarity against every blob. These should filter by model at minimum, and `findNeighbors()` should route through `annSearch()` when a VSS index exists.

#### 5.2.4 Three-signal ranking resolves paths for all candidates

When `useThreeSignal` is true, `vectorSearch()` fetches paths for ALL candidates (to compute path-relevance weight), then re-fetches paths for the top-K results. Should resolve paths only after scoring, for the final top-K.

#### 5.2.5 `AsyncQueue` has no backpressure

The pipelining `AsyncQueue` (Phase 69) allows unbounded buffering. If the producer (batch reader) is faster than the consumer (embedder), the `items` array grows without limit. A `maxBufferSize` with `async push()` backpressure would bound memory usage.

### 5.3 Performance summary

| Operation | Current | At Scale (100K+ blobs) | Recommendation |
|---|---|---|---|
| Search (default) | Auto-cap 50K, O(50K) JS cosine | Safe but ~300 MB allocation | SQL-level filtering + LIMIT |
| Search (ANN) | HNSW when built | O(log n) per query ✅ | Already addressed |
| Indexing | Pipelined batch, parallel commit embed | Hours for 200K+ blobs at cloud latency | Progress estimation, checkpointing |
| Evolution | O(n) full scan per query | Slow on large indexes | ANN integration for neighbor finding |
| Dedup check | O(1) per blob × N blobs | N SQLite calls per run | Batch check via `filterNewBlobs()` |

---

## 6) Code Quality Deep Dive

### 6.1 Error handling patterns

**Good patterns:**
- Embedding provider errors caught per-blob in `indexer.ts` — failed blobs are counted in stats, not fatal
- MCP tools wrap all handlers in try-catch and return error text to the client
- HTTP routes return appropriate status codes (502 for provider errors, 400 for bad input)
- `batching.ts` implements exponential backoff with retry (2 attempts, 300ms base delay)

**Problematic patterns:**

| Pattern | Location | Risk |
|---|---|---|
| Broad catch swallows real errors | `hybridSearch.ts` L44 | FTS5 query error catch also swallows DB I/O errors |
| No retry on single-blob embed | `indexer.ts` | Transient network errors kill the blob permanently |
| Symbol embed failures silently ignored | `indexer.ts` function chunker path | `continue` on symbol failure — no counter, no log |
| `annSearch()` returns null on any error | `vectorSearch.ts` | Disk corruption silently falls back to exact search |
| Git spawning has no timeout | `evolution.ts` (3 locations) | Stale NFS/network mount hangs process forever |
| Queue doesn't propagate errors | `asyncQueue.ts` | Producer crash → consumers block forever (memory leak) |

### 6.2 Type safety

**Good:**
- `strict: true` in `tsconfig.json`, consistently enforced
- No `any` casts found in grep scan
- No `TODO/FIXME/HACK` comments in source
- No `console.log` in library code (only in CLI handlers and `logger.ts`)

**Areas for improvement:**

| Issue | Impact |
|---|---|
| `SearchResult` has ~12 optional fields | Every consumer writes defensive null checks. Discriminated union (`FileResult ∣ ChunkResult ∣ SymbolResult`) would be more precise. |
| Module-level results use `blobHash: ''` | Empty string instead of synthetic ID; still violates the semantic contract of `blobHash` as a SHA-1 hash. |
| `quantized`, `quantMin`, `quantScale` are optional on all embedding tables | Should be required with defaults (0, null, null) at the schema level, not optional at the TypeScript level. |
| `bufferToEmbedding()` defined in both `evolution.ts` and `vectorSearch.ts` | Code duplication; divergence risk if quantization handling is updated in only one copy. |

### 6.3 Security

**Strong:**
- Bearer auth with `timingSafeEqual()` prevents timing attacks
- Per-repo access control via `repo_tokens` table
- Rate limiting with configurable RPM
- Drizzle ORM parameterized queries prevent SQL injection
- FTS5 `sanitizeFtsQuery()` properly escapes quote characters

**Needs attention:**

| Concern | Location | Severity |
|---|---|---|
| No input size limit on HTTP body | `app.ts` / Express config | Medium — large POST bodies could exhaust memory |
| `baseUrl` for embedding providers not validated | `local.ts`, `http.ts` | Medium — SSRF risk if configured via env var from untrusted source |
| Blob content stored in plaintext in FTS5 | `blob_fts` table | Low — documented risk, but no opt-out mechanism |
| API key in `Authorization` header could appear in debug logs | `http.ts` | Low — `logger.ts` doesn't log headers, but verbose mode could |

### 6.4 Code organization metrics

| Metric | Value |
|---|---|
| Total TypeScript files (src/) | 166 |
| Total lines (src/) | ~34,000 |
| Total test files | 59 |
| Total test lines | ~10,000 |
| Test-to-source ratio (lines) | 0.29:1 |
| CLI commands | 57 |
| MCP tools | 25+ |
| HTTP routes | 30+ |
| Schema tables | 19 + 1 FTS5 |
| Largest files | `cli/index.ts` (1,593), `mcp/server.ts` (1,542), `search/clustering.ts` (1,334) |
| Files > 500 lines | 8 |
| Files > 300 lines | ~18 |
| Files < 100 lines | ~90 |

The codebase is well-partitioned. The median file size is ~120 lines, and only 8 files exceed 500 lines. The three largest files are the primary candidates for modularization.

---

## 7) Database and Schema Assessment

### 7.1 Schema evolution: v0 → v19

19 migrations shipped across 84 phases. The migration system is idempotent (using `IF NOT EXISTS` and column-presence guards), but has accumulated complexity:

- v9→v10 performs a full table rebuild of the embeddings table (turns off foreign keys, copies all data, drops original, renames). This is expensive on large databases and disables FK enforcement temporarily.
- v14→v19 added `repos`, `repo_tokens`, `projections`, `saved_queries`, `embed_config` extensions plus `last_used_at` column.

**Fresh databases** skip all migrations and create the schema directly at v19 — correct optimization.

### 7.2 Schema integrity concerns

| Issue | Severity | Impact |
|---|---|---|
| **No `ON DELETE CASCADE`** on blob FKs | High | Manually deleting a blob leaves orphaned rows in embeddings, chunks, symbols, paths, blob_commits, blob_branches, cluster_assignments |
| **No unique constraint on `(blob_hash, path)`** in paths table | Medium | Duplicate path rows if indexer processes same blob+path twice (mitigated by in-memory dedup, not DB-enforced) |
| **FTS5 content written outside main transaction** | Medium | Process crash between blob insert and FTS5 insert leaves blob in vector search but missing from hybrid search. Recovery requires `gitsema index rebuild-fts`. |
| **`query_embeddings` cache grows unbounded** | Low | No TTL or size limit. Heavy query workloads accumulate stale entries. Needs periodic cleanup or LRU eviction. |
| **Labeled DB handles never closed** | Low | `_labeledDbs` Map in `sqlite.ts` holds DB connections forever. Memory leak in long-running server processes with many repos. |

### 7.3 Index coverage

Foreign key columns that would benefit from indexes (some may already be created by migrations — would need to verify):

```sql
CREATE INDEX IF NOT EXISTS idx_blob_commits_commit ON blob_commits(commit_hash);
CREATE INDEX IF NOT EXISTS idx_symbols_blob ON symbols(blob_hash);
CREATE INDEX IF NOT EXISTS idx_symbols_chunk ON symbols(chunk_id);
CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_model ON chunk_embeddings(model);
```

The `paths(blob_hash)` index exists (added in v12). The `embeddings(blob_hash, model)` composite PK serves as its own index.

---

## 8) Operational Readiness

### 8.1 Resolved since review5

| Gap (review5) | Resolution |
|---|---|
| No observability | Prometheus `/metrics` with latency histograms, counters (Phase 71) |
| No rate limiting | `express-rate-limit` per-token/per-IP (Phase 71) |
| No deployment documentation | `docs/deploy.md` with systemd, Docker, backup, model rotation guides (Phase 73) |
| No result-level access control | Per-repo tokens via `repo_tokens` table (Phase 75) |
| No result caching | `resultCache.ts` with 60s TTL + version invalidation |

### 8.2 Remaining operational gaps

| Gap | Impact | Effort |
|---|---|---|
| **No request body size limit** | Medium — large POST bodies could exhaust server memory | Low — `express.json({ limit: '1mb' })` |
| **No graceful shutdown** | Medium — in-flight indexing operations lost on SIGTERM | Medium — drain queue, flush pending writes, close DB |
| **No health check endpoint** | Low — standard for container orchestration (`/healthz`) | Low — ~10 lines |
| **No log-level runtime toggle** | Low — requires restart to change verbosity | Low — add `POST /admin/log-level` |
| **SQLite WAL file growth** | Low — WAL can grow unbounded under sustained writes | Low — periodic `PRAGMA wal_checkpoint(TRUNCATE)` |
| **No connection pooling for labeled DBs** | Low — each repo holds an open connection forever | Medium — TTL-based eviction |

---

## 9) Phase velocity and development patterns

### 9.1 Phase progression: v0.70.0 → v0.83.0

| Phase | Version | Theme |
|---|---|---|
| 71 | v0.71.0 | Index status dashboard + model management; metrics, rate limit, OpenAPI |
| 72 | v0.72.0 | HTTP route parity for all analysis commands |
| 73 | v0.73.0 | Deployment guide + Docker infrastructure |
| 74 | v0.74.0 | Scale warnings + extended doctor |
| 75 | v0.75.0 | Per-repo access control |
| 76 | v0.76.0 | HTML renderer modularization |
| 77 | v0.77.0 | Unified indexing + search level concept |
| 78–81 | v0.78.0 | REPL, quickstart, regression-gate, cross-repo, code-review |
| 82 | v0.79.0 | Auto-cap search memory |
| 83 | v0.80.0 | Parallel commit-message embedding |
| 84 | v0.81.0 | LSP definition/references/documentSymbol |
| — | v0.82.0 | Model profiles: custom prefixes and roles |
| — | v0.83.0 | CLI command group reorganization |

13 minor versions in the span since review5. The pace is high. Quality has been maintained — no regressions detected in the core logic, though test suite health (§3) needs attention.

### 9.2 Documentation staleness

The canonical docs have accumulated drift:

| Document | Issue |
|---|---|
| `CLAUDE.md` | States schema v17 and ~364 tests; actual is v19 and ~695 tests. States 24 MCP tools; actual is 25+. Feature table references review5 but review6 (this doc) is now current. |
| `features.md` | Header says v0.70.0 / schema v17 / ~364 tests. Many Phase 77–84 features not listed. Model management section added but index/search sections don't reference unified level concept. |
| `PLAN.md` | Phases 71–84 are documented. Phase numbering has a collision: two "Phase 71" entries (one for index status dashboard, one for operational readiness). Both shipped in v0.71.0 — should be merged or renumbered. |
| `README.md` | May not reflect all new commands (`repl`, `quickstart`, `code-review`, `cross-repo-similarity`, `models`) or the `gitsema index start` vs `gitsema index` distinction. |

---

## 10) New Feature Proposals (12 items)

### Tier 1 — Test suite and reliability (essential)

1. **Fix the 8 failing tests**
   Close DB connections explicitly before `rmSync` in `afterAll`. Normalize path separators in `config.test.ts`. Isolate `annSearch.test.ts` from workspace state. Add `os: [ubuntu-latest, windows-latest]` to CI matrix.

2. **SQL-level candidate filtering for search**
   Apply time, branch, and model filters + `ORDER BY RANDOM() LIMIT N` at the SQL layer instead of loading all rows into JS and sampling post-hoc. Most impactful single change for large-index memory safety.

3. **Batch dedup check in local indexer**
   Replace per-blob `isIndexed()` calls with `filterNewBlobs()` batch check (500-item chunks). The remote indexer already does this correctly — align the local path.

### Tier 2 — Code organization (high leverage)

4. **MCP server modularization**
   Split `mcp/server.ts` into domain-grouped tool files: `tools/search.ts`, `tools/analysis.ts`, `tools/clustering.ts`, `tools/workflow.ts`, `tools/infrastructure.ts`. Extract shared try-catch-embed-serialize pattern into a `registerTool()` helper.

5. **CLI index.ts command registration splitting**
   Move registration into per-domain files: `register/search.ts`, `register/analysis.ts`, `register/indexing.ts`, etc. The `cli/index.ts` becomes a thin aggregator.

6. **Search module directory organization**
   Group the 31 files in `src/core/search/` into subdirectories: `temporal/`, `analysis/`, `clustering/`, `quality/`. Use re-exports from `search/index.ts` for backward compatibility.

### Tier 3 — Robustness (important for production)

7. **Embedding retry with exponential backoff**
   The `batching.ts` wrapper already implements retry for batch calls, but the per-blob path in `indexer.ts` has no retry logic. Add 2-attempt retry with 500ms backoff for transient errors (HTTP 429, 503, ECONNRESET).

8. **AsyncQueue backpressure and error propagation**
   Add `maxBufferSize` to `AsyncQueue` with async `push()` that blocks when buffer is full. Add `pushError(err)` method that wakes all blocked consumers with the error.

9. **FTS5 content inside main transaction**
   Move the `storeFtsContent()` call inside the `storeBlob()` transaction so blob + FTS5 are atomic. This prevents the split-brain state where a blob exists in vector search but not in hybrid search.

10. **Request body size limit on HTTP server**
    Add `express.json({ limit: '1mb' })` (or configurable via `GITSEMA_MAX_BODY_SIZE`) to prevent memory exhaustion from oversized POST bodies.

### Tier 4 — Scale and features (future)

11. **Documentation sync automation**
    Add a pre-commit hook or CI check that validates: (a) `CLAUDE.md` version/schema/test count matches `package.json` and `sqlite.ts`, (b) `features.md` header version is current, (c) new CLI commands have `README.md` entries. This would prevent the drift documented in §9.2.

12. **LLM narrator test coverage**
    `src/core/llm/narrator.ts` exports ~10 narration functions with zero test coverage. Add unit tests with a mock HTTP server that returns canned chat completions, verifying prompt construction, error fallback, and response parsing.

---

## 11) Detailed Code Findings

### 11.1 `vectorSearch.ts` — cache key collision risk

`buildCacheKey()` omits `allowedHashes` from the cache key. Two calls with the same query string but different `allowedHashes` filter sets will collide and return the cached (unfiltered) result. This affects branch-scoped search when called multiple times with different branch filters.

**Fix:** Include a hash of `allowedHashes` (or its size) in the cache key.

### 11.2 `hybridSearch.ts` — BM25 normalization edge case

When all candidate rows have identical BM25 scores, `range === 0`, and all rows receive a normalized BM25 score of 1.0. In score fusion, this inflates the hybrid score beyond the intended weight distribution.

**Fix:** When `range === 0`, set all BM25 scores to 0.5 (neutral) instead of 1.0.

### 11.3 `local.ts` — batch fallback catch logic is inverted

The catch block in `embedBatch()` has confusing conditional logic:
```typescript
if (!(err instanceof Error && err.message.includes('Ollama batch embed failed'))) {
  if (!this._batchEndpointUnavailable) throw err
} else { throw err }
```
This re-throws on the wrong conditions. The intent is to catch HTTP 404 (old Ollama without `/api/embed`) and fall back to sequential, but the current logic also swallows other error types when `_batchEndpointUnavailable` is true.

**Fix:** Restructure to explicitly match the 404 case and re-throw everything else.

### 11.4 `evolution.ts` — `bufferToEmbedding()` duplication

This utility function exists in both `evolution.ts` and `vectorSearch.ts`. If quantization support is updated in one copy but not the other, deserialization will silently produce wrong results.

**Fix:** Extract to `src/utils/embedding.ts` and import from both locations.

### 11.5 `indexer.ts` — within-run dedup SIZE_CAP pruning is destructive

The `seenHashes` set has a `SIZE_CAP` of 50K. When exceeded, a pruning heuristic runs — but the comment says it removes the first half. After pruning, previously-seen blobs may be re-processed (wasting embedding calls). This is a correctness tradeoff for memory that isn't documented in the CLI help or logging.

**Fix:** Log a warning when pruning occurs. Consider using a Bloom filter for within-run dedup (constant memory, no false negatives).

### 11.6 Schema: `paths` table missing unique constraint

The `paths` table has no unique constraint on `(blob_hash, path)`. The indexer prevents duplicates via in-memory dedup (`seenHashes`), but direct `blobStore.storeBlob()` calls (from the HTTP server's blob upload route) can insert duplicate rows.

**Fix:** Add `UNIQUE (blob_hash, path)` constraint in the next schema migration.

---

## 12) Summary Scorecard

| Area | Score | Trend | Notes |
|---|---|---|---|
| **Architecture** | ⭐⭐⭐⭐½ | ↑ | Content-addressed model is excellent. Three-surface parity is strong. Modularization needed in 3 files. |
| **Code Quality** | ⭐⭐⭐⭐ | → | Strict TS, no tech debt markers, clean patterns. Error handling inconsistencies. |
| **Test Coverage** | ⭐⭐⭐½ | ↑ | 695 tests, up from 364. Gaps in LSP, LLM, provider failure paths. 8 tests fail on Windows. |
| **Performance** | ⭐⭐⭐⭐ | ↑ | Auto-cap and parallel commit embed address review5 gaps. SQL-level filtering remains. |
| **Security** | ⭐⭐⭐⭐ | ↑ | Timing-safe auth, rate limiting, per-repo access. Missing body size limit. |
| **Operational** | ⭐⭐⭐⭐ | ↑↑ | Prometheus, rate limit, OpenAPI, Docker, deploy guide all new since review5. |
| **Documentation** | ⭐⭐⭐ | ↓ | Canonical docs have version/count drift. Need automated sync checks. |
| **Scale Readiness** | ⭐⭐⭐½ | ↑ | Safe defaults for <50K blobs. SQL-level filtering needed for 100K+. |

**Overall: The project has matured significantly since review5. The primary investment areas are now test reliability, documentation sync, and the three large-file modularizations (MCP server, CLI index, clustering). No architectural changes needed — the foundations are solid.**
