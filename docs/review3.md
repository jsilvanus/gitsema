# Code Review 3 — Post-Phases-37–47 State of `gitsema`

> **Scope:** Current snapshot is **v0.49.0** (47 implemented phases). The prior review
> (`docs/review2.md`) covered **v0.35.0** (36 phases). This review does not rewrite
> review2; it references it explicitly and focuses on what changed, what was fixed,
> what was added, and what remains open.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Feature Completeness](#2-feature-completeness)
   - 2.1 [CLI Command Inventory](#21-cli-command-inventory)
   - 2.2 [MCP Tool Parity](#22-mcp-tool-parity)
   - 2.3 [HTTP Route Parity](#23-http-route-parity)
   - 2.4 [Cross-Cutting Flag Parity](#24-cross-cutting-flag-parity)
   - 2.5 [Phase 41–47 Feature Assessment](#25-phase-4147-feature-assessment)
3. [Performance](#3-performance)
   - 3.1 [Resolved Issues from review2](#31-resolved-issues-from-review2)
   - 3.2 [Still-Open Issues](#32-still-open-issues)
   - 3.3 [New Performance Concerns](#33-new-performance-concerns)
4. [Architecture and Maintainability](#4-architecture-and-maintainability)
5. [Test Coverage and CI Reliability](#5-test-coverage-and-ci-reliability)
6. [UX and Documentation Quality](#6-ux-and-documentation-quality)
7. [Security and Safety](#7-security-and-safety)
8. [Prioritized Gap and Improvement List](#8-prioritized-gap-and-improvement-list)
9. [Plans for Further Features (Phase 48+)](#9-plans-for-further-features-phase-48)

---

## 1. Executive Summary

Between v0.35.0 and v0.49.0, `gitsema` grew from **28 CLI commands / 13 MCP tools / 16
HTTP routes** to **47 CLI commands / 20 MCP tools / 22+ HTTP routes**, and the SQLite
schema advanced from version 9 to version 14. Fourteen minor-version bumps span:

- **Phases 37–40**: quick-wins (code-search, boolean queries, GC, bisect), analysis
  features (doc-gap, contributor-profile, refactor-candidates, lifecycle, ci-diff), and
  visualizations (map, heatmap, cherry-pick-suggest) — addressing the entire Part 3
  priority matrix from review2.
- **P0/P1/P2 performance fixes**: six missing DB indexes added, `Float32Array` path
  throughout the scoring hot-loop, pre-computed query norm, single-pass min/max,
  `Map` lookup replacing `indexOf` in clustering, `git cat-file --batch`, warm-start
  k-means, FTS5 batch inserts, SQL branch-filter subqueries, and job-registry eviction.
- **Feature-parity PR**: all 13 critical + 16 important gaps from review2 Part 1
  resolved (missing flags and routes for `semantic-diff`, `semantic-blame`,
  `file-change-points`, `cluster-diff`, `cluster-timeline`, `dead-concepts`,
  `merge-audit`, `merge-preview`, `branch-summary`; missing MCP tools added).
- **Phases 41–47**: multi-repo registry, minimal LSP server, semantic security scan,
  health timeline, technical debt scoring, evolution alerts, and richer indexing
  progress reporting.

The most significant remaining gaps are: **batch embedding** (C6 from review2 was never
closed — the indexer still embeds one blob per HTTP round-trip), **no server-side routes
for any Phase 41–47 command**, **stub-quality LSP and multi-repo** implementations,
and **thin test coverage of server routes and the MCP layer**.

---

## 2. Feature Completeness

### 2.1 CLI Command Inventory

As of v0.49.0 the following commands exist (47 total, up from 28 at review2):

| Category | Commands |
|----------|----------|
| **Core indexing** | `index`, `status`, `backfill-fts`, `rebuild-fts`, `gc`, `vacuum`, `build-vss`, `clear-model`, `update-modules`, `remote-index` |
| **Search** | `search`, `first-seen`, `code-search`, `diff`, `semantic-diff` |
| **Temporal / history** | `evolution`, `concept-evolution`, `change-points`, `file-change-points`, `bisect`, `lifecycle` |
| **Analysis** | `clusters`, `cluster-diff`, `cluster-timeline`, `cluster-change-points`, `author`, `impact`, `dead-concepts`, `semantic-blame`, `refactor-candidates`, `doc-gap`, `contributor-profile`, `cherry-pick-suggest`, `ci-diff` |
| **Branch / merge** | `merge-audit`, `merge-preview`, `branch-summary` |
| **Visualization** | `heatmap`, `map` |
| **Infrastructure** | `serve`, `mcp`, `repos`, `lsp`, `doctor`, `config` |
| **Phase 41–47 analysis** | `security-scan`, `health`, `debt` |

All review2 Part 3 items were implemented (see `docs/PLAN.md` Phases 37–40 bodies).

### 2.2 MCP Tool Parity

**20 MCP tools** are now registered in `src/mcp/server.ts` (up from 13 at review2).
Tools added since review2: `code_search`, `branch_summary`, `merge_audit`,
`merge_preview`, `clusters`, `change_points`, `semantic_diff`, `semantic_blame`,
`file_change_points`, `cluster_diff`, `cluster_timeline`, `author`, `impact`,
`dead_concepts`.

**Remaining MCP gaps (after reviewing `src/mcp/server.ts`):**

| Missing MCP tool | CLI command | Priority |
|-----------------|-------------|----------|
| `repos` | `repos` | Low — metadata registry only |
| `security_scan` | `security-scan` | Medium |
| `health` | `health` | Medium |
| `debt` | `debt` | Medium |
| `doc_gap` | `doc-gap` | Low |
| `contributor_profile` | `contributor-profile` | Low |
| `semantic_bisect` | `bisect` | Low |

Flag parity on existing tools is broadly good. Residual minor gaps:
- `semantic_search`: `--not-like` / `--lambda` (contrastive search) not exposed via MCP.
- `index`: `--quantize`, `--build-vss` not wired through MCP tool.

### 2.3 HTTP Route Parity

**22+ routes** under `/api/v1/` (up from 16 at review2):

| Prefix | Routes |
|--------|--------|
| `/status` | `GET /` |
| `/blobs` | `POST /check`, `POST /` |
| `/commits` | `POST /`, `POST /mark-indexed` |
| `/search` | `POST /`, `POST /first-seen` |
| `/evolution` | `POST /file`, `POST /concept` |
| `/remote` | `POST /index`, `GET /jobs/metrics`, `GET /jobs/:jobId/progress` |
| `/analysis` | `POST /clusters`, `POST /change-points`, `POST /author`, `POST /impact`, `POST /semantic-diff`, `POST /semantic-blame`, `POST /dead-concepts`, `POST /merge-audit`, `POST /merge-preview`, `POST /branch-summary` |

All six high-priority routes called out in review2 (`semantic-diff`, `semantic-blame`,
`dead-concepts`, `merge-audit`, `merge-preview`, `branch-summary`) are now present
(`src/server/routes/analysis.ts`).

**Still missing HTTP routes** for Phase 41–47 commands:

| Missing route | Command |
|--------------|---------|
| `POST /analysis/security-scan` | `security-scan` |
| `POST /analysis/health` | `health` |
| `POST /analysis/debt` | `debt` |
| `POST /analysis/doc-gap` | `doc-gap` |
| `POST /analysis/contributor-profile` | `contributor-profile` |

The remote serve model has no discoverability endpoint either — a client must know which
routes exist; there is no `GET /api/v1/capabilities` or OpenAPI spec.

### 2.4 Cross-Cutting Flag Parity

Review2 documented a detailed gap matrix for `--hybrid`, `--branch`, `--html`, `--vss`,
`--model`, `--include-commits`, `--chunks`, `--level`. All critical and important gaps
from that matrix were resolved in the feature-parity PR. Current residual nice-to-have
gaps:

| Feature | Commands still missing it |
|---------|--------------------------|
| `--html` | `debt`, `health`, `security-scan`, `contributor-profile`, `doc-gap` |
| `--vss` | `first-seen` (prints warning), `author` |
| `--not-like/--lambda` | Only wired through `search`; `code-search` and `author` don't support it |

### 2.5 Phase 41–47 Feature Assessment

#### Phase 41 — Multi-Repo Registry (`src/core/indexing/repoRegistry.ts`)

The `repos` table (schema v14) stores repo metadata (id, name, url, addedAt).
`gitsema repos add` / `repos list` work. **Limitation**: there is no
`gitsema repos search` command or unified cross-repo query path. The registry is
an administrative list; it does not yet enable "search across repo A and repo B
simultaneously." The Phase 41 body in PLAN.md acknowledges this is a stub but
the CLAUDE.md summary presents it as complete multi-repo support, which is
misleading.

#### Phase 42 — LSP Server (`src/core/lsp/server.ts`)

Implements JSON-RPC over stdio with `initialize`, `initialized`, `shutdown`, `exit`,
and `textDocument/hover`. The hover handler embeds the hovered word and returns the
top-5 nearest blobs as plain text. **Gaps**:
- Only `textDocument/hover` is supported; no `textDocument/definition`,
  `textDocument/references`, `workspace/symbol`, or completion.
- The hover response format is a raw newline-joined string of
  `hash score path` tuples, not a valid LSP `MarkupContent` object — some clients
  will reject or misformat it.
- No incremental re-indexing on file-save; the LSP server is a read-only query
  interface.
- The `lspCommand()` has no `--port` / `--tcp` option; it only works over stdio,
  which limits IDE integration to stdio-capable plugins.

#### Phase 43 — Security Scan (`src/core/search/securityScan.ts`)

Six hard-coded vulnerability query strings are embedded and the top-N nearest blobs
returned for each. **Important caveats**:
1. This is semantic similarity search, **not static analysis**. A blob that
   discusses the concept of SQL injection in a comment will rank high. The output
   is a triage aid, not a finding.
2. The six patterns are language-agnostic prose queries; there is no language-specific
   heuristic or regex layer. False-positive rate will be high on documentation and
   test files.
3. `src/cli/commands/securityScan.ts:22` uses `require('node:fs')` inside an async
   action handler — a CommonJS `require()` in an ESM module. This works at runtime
   on Node.js because `node:fs` is a built-in, but it defeats the ESM lint rules and
   will fail with bundlers or strict ESM environments. Use `import` at the top.

#### Phase 44 — Health Timeline (`src/core/search/healthTimeline.ts`)

Produces time-bucketed snapshots of `activeBlobCount`, `semanticChurnRate`, and
`deadConceptRatio`. Implementation detail: for 12 buckets (default), 5 SQL queries
execute per bucket (one to load all commit timestamps, one HEAD-blob query, then 3
per bucket) = ~2 + 12×3 = **38 SQL queries per invocation**. These are prepared
statements but not parameterised at the right level — `rawDb.prepare()` is called
inside the loop, which rebuilds the prepared statement object on every iteration.
Move `rawDb.prepare()` calls outside the loop.

The `--branch` option is accepted but silently ignored: the implementation does not
filter commits by branch membership (`blob_branches` is never queried).

#### Phase 45 — Debt Scoring (`src/core/search/debtScoring.ts`)

The scoring logic is sound (age + inverse change-frequency + isolation). HNSW path
(via usearch) is used when a pre-built `.gitsema/vss.index` exists; cosine scan
fallback otherwise. The cosine scan is **O(N²)** (every blob vs. every other blob)
which is prohibitive for >10K blobs. `src/core/search/debtScoring.ts:156` loads the
full `paths` table unconditionally (`rawDb.prepare('SELECT blob_hash, path FROM paths').all()`), bringing all path data into memory even when `--top 5` is requested.

#### Phase 46 — Evolution Alerts

`buildCommitUrl` correctly handles GitHub, GitLab, and Bitbucket URL shapes.
`extractAlerts` identifies timeline jumps above threshold. Both are unit-tested
(`tests/evolutionAlerts.test.ts`). The `--alerts` flag on the `evolution` command
is well-integrated. This phase is complete and clean.

#### Phase 47 — Richer Indexing Progress

`formatElapsed`, per-stage timing, embed-latency avg/p95, and ETA are well
implemented in `src/cli/commands/index.ts`. The incremental-mode messaging
(`Mode: incremental (resuming from <hash>)`) significantly improves UX. The
progress line is TTY-aware (overwrites the previous line with `\r`). The
`--help` text was updated with a metric glossary. This phase is polished.

---

## 3. Performance

### 3.1 Resolved Issues from review2

The P0/P1/P2 performance PR closed the following items from review2 Part 2:

| ID | Issue | Resolution |
|----|-------|-----------|
| C2 | 6 missing DB indexes | ✅ Added in schema v12 migration (`src/core/db/sqlite.ts`) |
| C3 | `Array.from(Float32Array)` copies | ✅ `Embedding` type is now `number[] | Float32Array`; `bufferToEmbedding` returns `Float32Array`; `cosineSimilarityPrecomputed` operates on typed arrays |
| C5 | Branch filter after full embedding load | ✅ SQL subquery in `vectorSearch`, `impact`, `deadConcepts` |
| H1 | Two-pass min/max with spread in `quantize.ts` | ✅ Single-pass loop |
| H2 | `indexOf()` in clustering hot loop | ✅ `Map<string, number>` replaces linear scan |
| H3 | Per-cluster SQL queries | ✅ Batched |
| H5 | Two git subprocess calls per blob | ✅ `git cat-file --batch` long-running subprocess (`src/core/git/showBlob.ts`) |
| H7 | Cold-start k-means per timestep | ✅ Warm-start with previous centroids (`ClusterSnapshot.centroids`) |
| H8 | Query norm recomputed per candidate | ✅ `vectorNorm(query)` pre-computed once; `cosineSimilarityPrecomputed` used in loop |
| H9 | Per-blob FTS5 insert | ✅ Batched within transaction |
| M10/M12 | Two-pass min/max in `timeSearch` + `hybridSearch` | ✅ Single-pass |
| M5 | Job registry never evicted | ✅ LRU eviction with `MAX_JOB_REGISTRY_SIZE` cap (`src/server/routes/remote.ts`) |

### 3.2 Still-Open Issues

#### C1 — Full Embedding Table Scan (Every Query)

**Status: Unchanged.** `vectorSearch.ts:163` calls `.all()` on the full embeddings
table before the branch/model filter reduces the result set. SQL branch and model
filters use `where()` clauses now, but the underlying Drizzle query still loads all
matching embedding rows into JS heap before JS-side scoring.

For a 100K-blob index at 384 dimensions: ~300 MB per query. The usearch HNSW index
(`--vss` flag) does provide sub-linear ANN search but it must be explicitly
pre-built and opted into; it is not the default path.

**Recommendation:** Make `--vss` the default when `.gitsema/vss.index` exists.
Detect the index file on startup and auto-enable ANN search without requiring the
user to pass `--vss`.

#### C4 — Full Paths Table Scan in `impact.ts`

**Status: Partially open.** The branch-filter subquery was added, but
`src/core/search/impact.ts` still appears to load all embedding rows before JS-side
scoring. Verify and add a SQL `LIMIT` clause to the embeddings query.

#### C6 — No Batch Embedding (HTTP Provider)

**Status: Unchanged.** `HttpProvider.embedBatch()` exists in
`src/core/embedding/http.ts` but `src/core/indexing/indexer.ts` calls `timedEmbed()`
which calls `provider.embed()` one text at a time. For a local HTTP provider
(without GPU), this means one HTTP round-trip per blob. At 2000 blobs and ~50 ms
per call, that is 100 seconds of serial HTTP overhead. Batching 64 blobs per request
would drop this to ~1.6 seconds.

**Recommendation:** Add a `batchEmbed()` wrapper in the indexer that accumulates
blobs into batches of configurable size (`--embed-batch-size`, default 32) and
calls `provider.embedBatch()`. Fall back to one-at-a-time for providers that
do not implement `embedBatch`.

### 3.3 New Performance Concerns

#### N1 — Health Timeline: Prepared Statements Inside Loop ✅ Fixed

`src/core/search/healthTimeline.ts` previously called `rawDb.prepare(...)` inside
the for-loop. The fix hoists all three `prepare()` calls above the loop and uses
parameterised binding, reducing object allocation from 3×buckets to 3 per call.

#### N2 — Debt Scoring: Full Paths Table Load ✅ Fixed

`debtScoring.ts` now scopes the paths query to candidate blob hashes via an
`IN (...)` clause (chunked in slices of 900 to stay within SQLite's variable
limit). This eliminates loading megabytes of path data when only a small `--top`
subset is needed.

#### N3 — Debt Scoring: O(N²) Cosine Scan Default

When no usearch index exists (the common case for new users), `scoreDebt()` falls
back to `computeIsolationCosineScan()`, which computes every-vs-every cosine
similarity. At 50K blobs × 384 dims, that is ~1.8 billion float operations.
Document this prominently and recommend `gitsema build-vss` before `gitsema debt`
in both the `--help` text and the README.

#### N4 — Security Scan: Sequential Per-Pattern Embedding + Search ✅ Fixed

`scanForVulnerabilities()` now embeds all 6 patterns concurrently via
`Promise.allSettled()` and processes the results in a single pass. Patterns that
fail to embed are skipped without crashing. Wall-clock time drops from ~6×
per-pattern latency to ~1× (bounded by the slowest pattern).

---

## 4. Architecture and Maintainability

### 4.1 Scale of Codebase

The codebase has grown substantially:

| Area | Lines of code | Notes |
|------|:------------:|-------|
| `src/cli/commands/` | ~6,000 | 47 command files |
| `src/core/search/` | ~5,500 | 25 search/analysis modules |
| `src/core/viz/htmlRenderer.ts` | 1,699 | Single file — needs splitting |
| `src/core/search/clustering.ts` | 1,334 | Single file — needs splitting |
| `src/mcp/server.ts` | ~1,100 | 20 tools in one file |
| `src/core/db/sqlite.ts` | 615 | Schema + migrations in one file |

`htmlRenderer.ts` is 1,700 lines with 14+ `render*Html` functions covering
clusters, diffs, evolution, heatmaps, etc. It has no clear internal module
boundary. When a new renderer is needed the file must be edited and the entire
module rebuilt. Consider splitting into `src/core/viz/renderers/` subdirectory
with one file per renderer.

`src/mcp/server.ts` at 1,100 lines with 20 inline tool handlers is approaching
the same problem. Consider extracting tool handlers into
`src/mcp/tools/<name>.ts` files.

### 4.2 ESM / CommonJS Inconsistency

Two instances of `require()` in an ESM codebase:

1. `src/cli/commands/securityScan.ts:22` — `const { writeFileSync } = require('node:fs')`. Should use the top-level `import { writeFileSync } from 'node:fs'`.
2. `src/core/chunking/functionChunker.ts:40,56` — dynamic `require('tree-sitter')` and `require(pkgName)`. These are intentionally dynamic (optional peer dep). Acceptable but should be wrapped in a try/catch comment explaining the pattern.

The `securityScan.ts` case is a clear bug: it will fail in strict ESM environments
(Bun, Deno, bundlers). Fix: add the import at the top of the file.

### 4.3 `getActiveSession()` Global State

`src/core/db/sqlite.ts` exposes `getActiveSession()` which returns a module-level
singleton. Every CLI command calls this. The pattern works for the CLI where only
one DB is open, but it makes unit testing harder (tests must call `withDbSession`
for isolation) and makes the serve mode fragile if multiple databases were ever
needed concurrently (e.g., multi-repo unified search). This is a known design
limitation; document it explicitly.

### 4.4 `indexer.ts` Complexity

`src/core/indexing/indexer.ts` is 722 lines with a single large `runIndex()`
function. The blob-processing inner loop now handles: whole-file embedding,
function chunking with fallbacks, fixed-window chunking, symbol extraction,
module centroid updates, quantization, commit mapping, and stage timing. Each
concern is well-commented but extraction into sub-functions (e.g.,
`embedBlob()`, `embedChunks()`, `updateModuleCentroid()`) would reduce cognitive
complexity and make the fallback chain testable in isolation.

### 4.5 Missing Input Validation

Several CLI commands parse integers from user options with `parseInt(..., 10)` but
provide no error on NaN or negative values. Example: `health.ts` —
`parseInt(opts.buckets ?? '12', 10)` with no guard. If a user passes
`--buckets abc`, `computeHealthTimeline` receives `NaN` and silently behaves
unexpectedly. Add a validation helper (e.g., `parsePositiveInt(str, name)`) shared
across commands.

---

## 5. Test Coverage and CI Reliability

### 5.1 Current State

| Area | Test files | Notes |
|------|:----------:|-------|
| Core search modules | 25 | Good unit coverage |
| Indexing pipeline | 2 | `indexProgress.test.ts`, integration test |
| Chunking | 1 | `chunking.test.ts` |
| DB schema / sqlite | 0 | No migration tests |
| HTTP routes (`src/server/`) | 0 | Completely untested |
| MCP server (`src/mcp/`) | 0 | Completely untested |
| CLI command files | 0 | No CLI integration tests |
| Phase 41–47 | 7 | `multiRepo`, `lsp`, `securityScan`, `healthTimeline`, `debtScoring`, `evolutionAlerts`, `indexProgress` |

**Highlights:**
- Phase 41–47 each have dedicated test files — test discipline improved.
- The integration test (`tests/integration/indexAndSearch.test.ts`) exercises the
  full `runIndex → vectorSearch` pipeline with a mock embedding provider and a real
  Git repo, providing good baseline confidence.
- `tests/lsp.test.ts` tests message framing and the `initialize` handler.
- `tests/debtScoring.test.ts` tests `computeIsolationCosineScan` edge cases
  (identical vectors → 0, orthogonal → 1, single blob → 0.5).

**Critical gaps:**
- Zero test coverage of Express routes. Any regression in request parsing,
  authentication bypass, error handling, or JSON serialization in
  `src/server/routes/*.ts` would be invisible.
- Zero test coverage of the MCP server. The 20 tool handlers are only reachable
  via `gitsema mcp` (stdio), not tested programmatically.
- No test for `--hybrid` mode end-to-end (requires FTS5 content in the DB).
- No test for the HNSW VSS path (`--vss`).
- `src/core/search/healthTimeline.ts` test (`tests/healthTimeline.test.ts`) covers
  the function but does not verify the `--branch` filter behaviour (which is silently
  ignored — a bug discoverable only by a targeted test).

### 5.2 Recommendations

1. Add a minimal Express supertest suite for the five most-used routes:
   `POST /search`, `POST /search/first-seen`, `POST /analysis/clusters`,
   `GET /status`, and the auth middleware. These protect the serve mode against
   regressions.
2. Add a test for the MCP `semantic_search` tool that stubs the DB and asserts the
   JSON-RPC response shape.
3. Add a test for `computeHealthTimeline` with a `--branch` value to expose the
   current silent-ignore bug.
4. Add migration regression tests: open a v1 DB, run migrations, assert the schema
   is at v14 and no data was lost.

---

## 6. UX and Documentation Quality

### 6.1 Help Text Quality

Phase 47 significantly improved `gitsema index --help`. However, the six Phase 41–47
commands have minimal help text:

| Command | Description quality | Missing in --help |
|---------|:-------------------:|-------------------|
| `lsp` | 1-line | Server lifecycle, stdio protocol, no IDE setup example |
| `repos add/list` | 1-line each | No guidance on when to use, no multi-repo context |
| `security-scan` | 1-line | No disclaimer that results are semantic approximations, not CVEs |
| `health` | 1-line | No description of what churn/deadRatio mean, no threshold guidance |
| `debt` | 1-line | No mention of O(N²) fallback or recommendation to run `build-vss` first |
| `bisect` | 1-line | No example of `--good/--bad` ref format |

The `security-scan` command in particular needs a prominent disclaimer in its
description: results are semantic similarity scores, not confirmed vulnerabilities.
Presenting them without context could mislead users into false confidence or panic.

### 6.2 README / User Guide

`CLAUDE.md` lists all commands but functions as a developer reference, not a user
guide. There is no user-facing `README.md` that:
- Explains what `gitsema` is to a new user in 3 sentences.
- Shows an end-to-end quickstart (install → index → search).
- Documents environment variables in a scannable table.
- Links to the command reference.

`docs/commands.md` exists but appears to be from an early phase and may be stale
relative to 47 commands. Verify and update.

### 6.3 Output Consistency

- `gitsema debt` outputs tab-separated `hash\tscore\tpath` without a header line.
- `gitsema health` outputs ISO timestamps without a header line.
- `gitsema security-scan` outputs `[pattern] score=... hash paths` with no JSON
  field names.
- Most other commands use labelled key=value output or structured JSON via `--dump`.

Consider a consistent `--format table|json|tsv` flag across analysis commands, or
at minimum adding header lines to all TSV-style outputs.

### 6.4 Stale Documentation

- `docs/commands.md` should list all 47 commands with their flags.
- `CLAUDE.md` MCP tool list shows 6 tools but the server now exposes 20.
- `CLAUDE.md` schema overview table is missing: `symbols`, `symbol_embeddings`,
  `module_embeddings`, `commit_embeddings`, `cluster_assignments`, `blob_clusters`,
  `saved_queries`, `repos`, and the `quantized`/`quant_min`/`quant_scale` columns.

---

## 7. Security and Safety

### 7.1 What Was Done Well

- **SSRF protection** (`src/core/git/cloneRepo.ts:122–158`): `validateCloneUrl()`
  enforces only `https://` and `ssh://` schemes, resolves the hostname via DNS, and
  rejects private IPv4 and IPv6 ranges (RFC1918, loopback, link-local). This is a
  solid SSRF defence for the remote-clone flow.
- **Bearer-token auth** (`src/server/middleware/auth.ts`): When `GITSEMA_SERVE_KEY`
  is set, all routes require `Authorization: Bearer <key>`. The middleware is applied
  globally to the Express app before any route.
- **No shell injection in git calls**: All git invocations use `spawn()` /
  `execFileSync()` with argument arrays, never template string interpolation into a
  shell command. This is the correct pattern.
- **Credentials via `GIT_ASKPASS`** (Phase 17): HTTPS tokens are passed through a
  temp credential helper file rather than embedded in the URL that appears in process
  listings.
- **SSH key file mode**: `writeSshKey()` (`src/core/git/cloneRepo.ts:231`) already
  writes with `{ mode: 0o600 }`. **No action required.**
- **Rate limiting on `/remote/index`**: The `getCloneSemaphore()` semaphore
  (`src/server/routes/remote.ts:438–449`) caps concurrent clone operations (default 2,
  configurable via `GITSEMA_CLONE_CONCURRENCY`) and returns `429 Too Many Requests`
  when the cap is exceeded. **No action required.**

### 7.2 Open Concerns

#### S1 — Timing-Safe Token Comparison ✅ Fixed

`src/server/middleware/auth.ts` now uses `crypto.timingSafeEqual()` to compare
the expected and actual `Authorization` header values, preventing timing-oracle
attacks.

#### S2 — No Rate Limiting on the HTTP Server ✅ Already Addressed

`POST /remote/index` is protected by a server-wide clone semaphore
(`getCloneSemaphore()` in `src/core/git/cloneRepo.ts`, configurable via
`GITSEMA_CLONE_CONCURRENCY`, default 2). When the semaphore is exhausted the
route immediately returns `429 Too Many Requests` with a `Retry-After: 30`
header. This was an incorrect finding in the initial review.

#### S3 — `require()` in ESM Module (`securityScan.ts`) ✅ Fixed

`src/cli/commands/securityScan.ts` now uses a top-level `import { writeFileSync }
from 'node:fs'` instead of the dynamic `require()` call.

#### S4 — Security Scan Output Can Mislead ✅ Fixed

`gitsema security-scan` now prints a disclaimer header before results:
`# Results are semantic similarity scores, not confirmed vulnerabilities.
Manual review required.`
The HTTP route (`POST /analysis/security-scan`) also includes a `disclaimer`
field in the JSON response.

#### S5 — Unvalidated Integer Options

Several commands pass user-supplied integers directly to SQL `LIMIT` clauses after
`parseInt(..., 10)`. If `parseInt` returns `NaN` (non-numeric input), Drizzle ORM
will emit `LIMIT NaN` which SQLite interprets as `LIMIT 0`. This could silently
return no results rather than an error. Validate all integer options at command
entry with a guard that exits with a clear message.

#### S6 — SSH Key Stored in Temp File World-Readable By Default ✅ Already Fixed

`writeSshKey()` in `src/core/git/cloneRepo.ts:231` already uses
`{ mode: 0o600 }`. This was an incorrect finding in the initial review.

---

## 8. Prioritized Gap and Improvement List

### Critical (must fix before production/public use)

| # | Gap | File | Status |
|---|-----|------|--------|
| **P0-1** | SSH key temp file world-readable | `src/core/git/cloneRepo.ts` | ✅ Already had `mode: 0o600` |
| **P0-2** | `require()` in ESM module | `src/cli/commands/securityScan.ts` | ✅ Fixed: top-level `import` |
| **P0-3** | Timing-unsafe auth token comparison | `src/server/middleware/auth.ts` | ✅ Fixed: `crypto.timingSafeEqual()` |

### High (significant UX or correctness impact)

| # | Gap | File | Status |
|---|-----|------|--------|
| **H1** | C6: No batch embedding in indexer | `src/core/indexing/indexer.ts` | ✅ Fixed: `--embed-batch-size` option |
| **H2** | `--branch` silently ignored in `health` | `src/core/search/healthTimeline.ts` | ✅ Fixed: filters via `blob_branches` |
| **H3** | Debt scoring O(N²) fallback undocumented | `src/cli/commands/debt.ts` | ✅ Fixed: warns when no HNSW index |
| **H4** | No HTTP routes for Phase 41–47 | `src/server/routes/analysis.ts` | ✅ Fixed: added `/security-scan`, `/health`, `/debt` |
| **H5** | No rate limiting on `/remote/index` | `src/server/routes/remote.ts` | ✅ Already had semaphore + 429 response |
| **H6** | `security-scan` output implies confirmed findings | `src/cli/commands/securityScan.ts` | ✅ Fixed: disclaimer header added |

### Medium (quality and maintainability)

| # | Gap | Fix | Status |
|---|-----|-----|--------|
| **M1** | `rawDb.prepare()` inside health-timeline loop | Move prepare() calls above loop | ✅ Fixed |
| **M2** | Full paths table load in `debtScoring.ts` | Scope to candidate blob hashes | ✅ Fixed: IN-clause scoped to candidates |
| **M3** | Zero server route tests | Add supertest suite for top-5 routes | ✅ Fixed: `tests/serverRoutes.test.ts` |
| **M4** | Zero MCP handler tests | Add programmatic MCP tool test | ✅ Fixed: `tests/mcpTools.test.ts` |
| **M5** | `htmlRenderer.ts` 1,700 lines | Split into per-renderer files | Deferred (large refactor, no behaviour change) |
| **M6** | LSP hover response not valid `MarkupContent` | Return `{ kind: 'plaintext', value: ... }` | ✅ Fixed |
| **M7** | Missing NaN guard on integer options | Add `parsePositiveInt()` helper | ✅ Fixed: `src/utils/parse.ts` + guards on `health`, `debt`, `security-scan` |
| **M8** | No auto-enable of VSS when index exists | Auto-detect `.gitsema/vss.index` at startup | ✅ Fixed: auto-detects in `search` command |
| **M9** | `docs/commands.md` stale | Regenerate from CLI `--help` output | ✅ Fixed: 47-command inventory with MCP tools table |
| **M10** | CLAUDE.md MCP and schema sections stale | Update to 23 tools and 20-table schema | ✅ Fixed |

### Low / Nice-to-Have

| # | Gap | Status |
|---|-----|--------|
| **L1** | `--html` on `debt`, `health`, `security-scan` | Open |
| **L2** | `--not-like/--lambda` on `author`, `code-search` | Open |
| **L3** | MCP tools for `security-scan`, `health`, `debt` | ✅ Fixed: `security_scan`, `health_timeline`, `debt_score` added |
| **L4** | OpenAPI spec / capabilities endpoint for HTTP server | Open |
| **L5** | Consistent `--format table\|json\|tsv` across analysis commands | Open |
| **L6** | Concurrent pattern search in `security-scan` (`Promise.all`) | ✅ Fixed: `Promise.allSettled` in `securityScan.ts` |
| **L7** | `indexer.ts` inner loop extraction into sub-functions | Open |
| **L8** | Migration regression tests | Open |

---

## 9. Plans for Further Features (Phase 48+)

These phases build on the v0.49.0 foundation. They are ordered by expected value
delivery, not implementation complexity.

### Phase 48 — Batch Embedding and Provider Throughput ✅ Implemented

**Goal:** Close the longstanding C6 gap; enable practical indexing of large repos
against local HTTP providers.

- Added `--embed-batch-size <n>` option to `gitsema index`.
- When `--chunker file` (default), the provider implements `embedBatch`, and no
  routing provider is active, blobs are processed in batches of `embedBatchSize`.
  This collapses N serial HTTP round-trips into N/batchSize batch requests.
- Falls back to per-blob `embed()` if `embedBatch` is unavailable or the batch
  call fails.
- **Recommended:** `--embed-batch-size 32` for local HTTP providers.

### Phase 49 — Auto-VSS Default Path

**Goal:** Surface ANN search without requiring `--vss` explicitly.

- On `getActiveSession()` (or lazily on first search), check if
  `.gitsema/vss.index` exists. If so, load the usearch index and set a
  session-level flag.
- `vectorSearch()` checks the flag and routes through HNSW automatically.
- Print a one-time info line: `Using ANN index (build-vss to update).`
- Add `gitsema index --auto-build-vss` to rebuild the index after each indexing
  run when blob count exceeds a configurable threshold.
- **Version:** minor bump.

### Phase 50 — Real Multi-Repo Search

**Goal:** Deliver on the Phase 41 promise: query across multiple repos in one
command.

- `gitsema repos search <query> [--repos id1,id2,...] [--top n]`
- Each registered repo must have a `db_path` column in the `repos` table.
- Open each DB with `openDatabaseAt(entry.db_path)`, run `vectorSearch()`,
  tag results with `repoId`, merge with `mergeSearchResults()`, re-rank.
- Expose as `POST /analysis/multi-repo-search` HTTP route and `multi_repo_search`
  MCP tool.
- **Version:** minor bump.

### Phase 51 — LSP Completion of the Protocol

**Goal:** Make `gitsema lsp` useful in real IDEs (VS Code, Neovim LSP, Helix).

- Implement `textDocument/definition` (find the blob that defines the symbol
  under cursor).
- Implement `workspace/symbol` (search all symbols by partial name).
- Return proper `MarkupContent` with Markdown hover cards.
- Add `--tcp <port>` option as an alternative to stdio.
- Expose a diagnostic: `gitsema doctor --lsp` to verify the LSP server starts
  correctly.
- **Version:** minor bump.

### Phase 52 — Query Expansion

**Goal:** Improve recall by expanding natural-language queries with repo-specific
vocabulary before embedding.

- After embedding the raw query, extract the top BM25 keywords from FTS5 results.
- Split camelCase/snake_case identifiers in those keywords
  (`splitIdentifier` already exists in `labelEnhancer.ts`).
- Append the top-5 keywords to the query string and re-embed.
- Gate behind `--expand-query` flag initially; make default if F1 improves in
  integration tests.
- **Version:** minor bump.

### Phase 53 — Saved Searches and Watch Mode

**Goal:** Notify when new indexed content matches a saved query.

- New DB table: `saved_queries (id, name, query_text, query_embedding BLOB,
  last_run_ts, webhook_url)`.
- `gitsema watch add <name> <query> [--webhook url]` — stores the query.
- `gitsema watch run` — for each saved query, re-run with `after=last_run_ts`,
  print/POST new matches, update `last_run_ts`.
- Add `POST /watch/add` and `POST /watch/run` routes.
- **Version:** minor bump.

### Phase 54 — Index Bundle Export / Import

**Goal:** Share a pre-built index as a compressed artifact — useful for team
settings where one machine builds the index and others query it.

- `gitsema export-index --out bundle.tar.gz` — archives
  `.gitsema/index.db` + `.gitsema/vss.index` (if present).
- `gitsema import-index --in bundle.tar.gz` — extracts to `.gitsema/`, validates
  schema version, runs any pending migrations.
- Checksums verify bundle integrity.
- **Version:** minor bump.

### Phase 55 — Embedding Space Explorer (Web UI)

**Goal:** Interactive 2D visualization of the embedding space.

- Compute UMAP/t-SNE projection on demand via a new `gitsema project` command
  (or reuse `gitsema map`). Store 2D coordinates in a `projections` table.
- `gitsema serve --ui` starts the HTTP server and also serves a single-page app
  from `src/client/` (React or plain HTML/JS).
- Features: pan/zoom, cluster coloring, hover → blob details, temporal slider
  animating by commit date, click → `gitsema show blob` in terminal.
- **Version:** minor bump.

### Phase 56 — LLM-Powered Evolution Narration

**Goal:** Convert the raw cosine-distance timelines from `gitsema evolution` into
human-readable semantic summaries.

- After computing `computeEvolution()`, format the timeline diffs as a prompt
  and call a configured LLM endpoint (OpenAI-compatible, controlled by
  `GITSEMA_LLM_URL` / `GITSEMA_LLM_MODEL`).
- `gitsema evolution <path> --narrate` prints a paragraph like: *"Between commit
  abc1234 and def5678, the authentication module shifted from session-based to
  JWT-based token management, with a 0.41 cosine distance — the largest semantic
  change in this file's history."*
- Fall back gracefully when no LLM is configured.
- **Version:** minor bump.

### Phase 57 — GitHub Actions Integration for CI Diff

**Goal:** Make `gitsema ci-diff` usable as a GitHub Actions step that posts a
semantic diff comment on PRs.

- Ship an official `jsilvanus/gitsema-action@v1` GitHub Action in a companion
  repo (or subdirectory).
- The action: checks out the repo, runs `gitsema index --file` for changed files,
  runs `gitsema ci-diff --base ${{ github.event.pull_request.base.sha }} --head
  ${{ github.sha }} --format html`, and posts the result as a PR review comment
  via the GitHub API.
- Add `--github-token` / `GITHUB_TOKEN` env var support to `ci-diff`.
- **Version:** minor bump.

### Phase 58 — Structured Security Scan (Static + Semantic)

**Goal:** Elevate `security-scan` from "semantic similarity" to a credible triage
tool.

- Add per-language regex/AST heuristics (parameterized queries, input sanitisation
  helpers) as a first pass to reduce false positives.
- Use tree-sitter (already present as an optional dep in `functionChunker.ts`) to
  identify taint flows: user input → sink without sanitization.
- Only promote a match to a finding when both semantic similarity AND a structural
  signal agree.
- Integrate with SARIF output format for GitHub Code Scanning upload.
- **Version:** minor bump.

### Long-Term Investments (Phase 59+)

| Feature | Complexity | Notes |
|---------|:----------:|-------|
| DuckDB / pgvector migration path | High | For corpora >500K blobs; keep SQLite as default |
| Cross-repo concept similarity | High | Index two repos; find when concept X first appeared in each |
| Semantic regression CI gate | High | Flag PRs where key embedding drifts beyond threshold |
| Plugin API for custom analysers | High | Allow third-party modules to register their own search/analysis commands |
| Python model server (Phase 13 revival) | Medium | sentence-transformers in Docker; higher throughput than Ollama for bulk indexing |
| Semantic code review assistant | Medium | Given a PR diff, find historical analogues and flag regressions |

---

*Reviewed at commit corresponding to v0.49.0 (Phase 47). All file citations verified
against the current state of `src/` at that tag.*
