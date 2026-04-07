# Code Review 5 — Scale, Operational Readiness, and Productization

This review builds on:

- `docs/review.md` through `docs/review4.md`

It reflects the repository state at **v0.70.0** (schema v17, ~364 tests, 148 TypeScript source files).

---

## 1) Executive Summary

All twelve proposals from review4 are now shipped (Phases 61–70). `gitsema` has moved from "broad prototype" to a tool with genuine breadth: 57 CLI commands, 16+ HTTP route groups, 31+ MCP tools, adaptive indexing, pipelined batching, workflow templates, and a unified output system. The surface is large and internally consistent.

The remaining gaps are no longer about missing primitives. They are:

1. **Scale ceiling** — search and indexing have known bottlenecks that appear around 50K–100K blobs.
2. **HTTP API incompleteness** — Phase 41–47 analysis commands exist in CLI and MCP but have no HTTP routes.
3. **Operational gaps** — no observability, no deployment guide, no rate limiting, no encryption-at-rest guidance.
4. **Type safety and code organisation** — a 77K-LOC renderer file, synthetic blob hashes leaking into typed interfaces, loose optional fields.
5. **LSP is a stub** — hover works; definition/references/symbols are empty stubs and should not be listed as shipped features.

---

## 2) Performance Bottlenecks

### 2.1 Full candidate materialisation (search)

`vectorSearch()` in `src/core/search/vectorSearch.ts` calls `.all()` to load the entire embedding candidate pool into JS memory before scoring in a pure-JS cosine loop. At scale:

- **50K blobs (768-dim, float32):** ~150 MB in-process + scoring loop
- **100K blobs:** ~300 MB + O(n) CPU cost per query

Mitigations exist (`--early-cut`, precomputed query norm, reservoir sampling added in Phase 64) but are opt-in. The default path has no guard.

**Recommended path:**
- Make `--early-cut` the default above a configurable `search.candidateLimit` (e.g. 50K).
- Extend the HNSW index (already built for clustering via `build-vss`) to serve as an ANN index for general search — this would cap query time regardless of index size.

### 2.2 Chunk/symbol candidate expansion

When `--chunks` or `--vss` is combined with a large index, the candidate pool grows 3–10× before the cosine loop runs. No secondary deduplication occurs until after scoring. This is the fastest path to OOM on production-sized repos.

### 2.3 Indexing: pipelining works, but commit-mapping is still serial

Phase 69 added `AsyncQueue`-based pipelined read/embed/store overlap — a meaningful improvement. However the commit-mapping phase (populating `blob_commits`, resolving paths per blob) still runs as a tight sequential loop after all batches complete. For repos with deep history this phase can dominate wall-clock time on incremental runs.

### 2.4 Path resolution per search result

`vectorSearch.ts` makes one SQL query per top-K result to resolve paths. Hybrid search batches this in 500-item chunks (better, but still linear). Both paths should be replaced with a single `WHERE blob_hash IN (...)` bulk lookup.

---

## 3) Missing HTTP Routes (Concrete Gap)

The following CLI commands (all implemented in Phases 41–47) have MCP tools but no HTTP API routes:

| CLI command | HTTP route | MCP tool |
|---|---|---|
| `gitsema security-scan` | ❌ missing | ✅ `security_scan` |
| `gitsema health` | ❌ missing | ✅ `health_timeline` |
| `gitsema debt` | ❌ missing | ✅ `debt_score` |
| `gitsema doc-gap` | ❌ missing | ❌ missing |
| `gitsema contributor-profile` | ❌ missing | ❌ missing |
| `gitsema triage` | ❌ missing | ❌ missing |
| `gitsema policy check` | ❌ missing | ❌ missing |
| `gitsema ownership` | ❌ missing | ❌ missing |
| `gitsema workflow run` | ❌ missing | ❌ missing |
| `gitsema eval` | ❌ missing | ❌ missing |

Each is approximately 40–60 LOC (Zod schema + handler + route registration). This is the most actionable near-term gap for teams that integrate via the HTTP API.

---

## 4) Operational Readiness Gaps

### 4.1 No observability

`src/utils/logger.ts` rotates log files, but no metrics are exported. In a shared server deployment there is no way to observe query latency, embedding provider error rate, cache hit ratio, or index throughput without parsing log files manually. A `/metrics` Prometheus endpoint on the HTTP server would cover this.

### 4.2 No rate limiting

The HTTP server has optional Bearer auth (`GITSEMA_SERVE_KEY`) but no request rate limiting. Long-running operations (`evolution`, `cluster-timeline`, `clusters` on large indexes) can trivially saturate server resources. `express-rate-limit` with per-IP or per-token caps would address this with minimal code.

### 4.3 No deployment documentation

There is no guide covering: running the HTTP server as a persistent service (systemd unit, Docker), securing the API key, connecting from CI/CD, backing up the index, rotating the embedding model, or migrating the SQLite schema. This is the primary adoption blocker for teams that want to self-host.

### 4.4 No encryption at rest

`.gitsema/index.db` stores full blob content (source code) in plaintext via the FTS5 virtual table. This is not documented as a data-handling consideration. For private or commercial codebases this needs explicit guidance (SQLite Cipher, filesystem encryption, or content-exclusion configuration).

### 4.5 No result-level access control

The multi-repo registry (`repos` table) is implemented, but all API consumers see all indexed content regardless of Git repository permissions. Any team deployment needs at minimum a per-repo API key model.

### 4.6 No result caching

The `query_embeddings` table caches embedding vectors for identical query strings (good), but not search results. Identical queries re-score the entire candidate pool on every call. A short-TTL result cache (60–120 s) would materially reduce load for AI assistant use cases where the same query fires multiple times in one session.

---

## 5) Code Quality Issues

### 5.1 htmlRenderer.ts — 77K LOC

`src/cli/htmlRenderer.ts` is a single 77,000-line file containing all HTML/JS visualisation code. It cannot be unit-tested in isolation, cannot be tree-shaken, and any change to any visualisation requires navigating the full file. It appears to be a generated or concatenated artifact. If generated, the generation pipeline should be documented and checked in. If hand-maintained, it should be split into per-feature modules (evolution, clustering, search, map).

### 5.2 Synthetic module blobHash leaks into typed interface

`vectorSearch.ts` returns `SearchResult` entries with `blobHash` set to synthetic strings like `"module:src/auth"` for module-level results. This violates the type contract — downstream callers that read `blobHash` to look up database records will get a non-SHA value. No branded/newtype exists to distinguish real blob hashes from synthetic module identifiers.

### 5.3 SearchResult optional explosion

`SearchResult` has ~12 optional fields. Several of these (e.g. `paths`, `firstSeen`) are always present in practice but typed as optional, forcing every consumer to write defensive null checks. Others are genuinely optional (chunk-specific fields). Splitting into discriminated union variants (`FileResult | ChunkResult | SymbolResult`) would make the type more precise and callers simpler.

### 5.4 LSP is a stub — should not be listed as shipped

`gitsema tools lsp` is documented as a shipped feature. In reality only hover is implemented. `textDocument/definition`, `textDocument/references`, and `textDocument/documentSymbol` return empty results or are not handled. This should be clearly marked as "hover only (preview)" in the feature catalog and README, or the stub handlers should be removed to avoid user confusion.

---

## 6) Test Coverage Gaps

| Area | Coverage | Note |
|---|---|---|
| Core indexing pipeline | Good | Integration tests with real Git repos + mock provider |
| Vector / hybrid search | Good | Ranking, recency, grouping well tested |
| Temporal operations | Good | Evolution, bisect, first-seen covered |
| Clustering | Good | Snapshot, diff, timeline |
| HTTP API endpoints | Minimal | No end-to-end POST /search with real db |
| MCP tool behaviour | Minimal | No transport-level tests |
| Embedding provider failures | Not tested | Timeout, rate-limit, partial batch failure |
| SQLite transaction rollback | Not tested | |
| Concurrent indexing (CLI + HTTP) | Not tested | AsyncLocalStorage isolation untested under concurrency |
| Large-scale performance | No benchmarks | No tests above ~1K blobs |

The highest-leverage gap is HTTP API integration tests. `supertest` + a mock embedding fixture and a real SQLite db would cover the entire route layer in ~150 LOC of test setup.

---

## 7) Productization for Small vs Large Repos

### Small repos (< 10K blobs)

Works well today. Friction points:

- **Discovery barrier:** `gitsema search` has 20+ flags. New users benefit from profiles (`--profile speed|balanced|quality`) but these aren't the default entry point and aren't mentioned in the quickstart.
- **Zero-to-result path:** The README shows `gitsema index` then `gitsema search`. A `gitsema doctor` pre-flight check and a `gitsema quickstart` guided wizard would reduce setup friction.
- **No interactive mode:** All usage is batch/scripted. A `gitsema repl` or interactive query loop would improve exploratory use.

### Large repos (> 50K blobs)

Has fundamental scale blockers today:

- **Indexing time:** Even with pipelined batching (Phase 69), a 200K-blob monorepo at cloud embedding API latencies takes hours. No progress estimate is shown beyond a running counter.
- **Search memory:** Candidate materialisation is proportional to index size. Not deployable as a shared service above ~100K blobs without `--early-cut`.
- **No index size guidance:** No tooling tells users "your index is 150K blobs; search will be slow; run `gitsema build-vss` to enable ANN search." The `gitsema status` command could surface this.
- **No incremental symbol indexing:** Symbol extraction re-runs on every blob. For large repos with `--chunker function`, this is expensive and not parallelised separately from embedding.

---

## 8) New Feature Proposals (12 items)

1. **HTTP routes for Phase 41–47 + Phases 65–70 commands**  
   Wire `security-scan`, `health`, `debt`, `doc-gap`, `contributor-profile`, `triage`, `policy check`, `ownership`, `workflow`, `eval` into the HTTP API. Lowest effort, highest surface parity gain.

2. **OpenAPI spec generation from Zod schemas**  
   Use `zod-to-openapi` or `@anatine/zod-openapi` to generate a spec from existing Zod request/response schemas. Enables client library generation and makes the API self-describing.

3. **`/metrics` Prometheus endpoint**  
   Expose query latency histograms, index size gauge, provider error counter, and cache hit ratio. Essential for shared server deployments.

4. **Rate limiting middleware**  
   Add `express-rate-limit` with per-token (or per-IP for unauthenticated) caps. Include a `Retry-After` header on 429 responses.

5. **`gitsema status` scale warnings**  
   When `gitsema status` detects an index above a configurable threshold (e.g. 50K blobs), print a recommendation to build VSS or enable early-cut. Same hint on first slow search.

6. **HNSW for general search (not just clustering)**  
   The `build-vss` pipeline already produces an HNSW index. Route `vectorSearch()` through it when the index is present and `--early-cut` is not explicitly set to zero. This would cap search latency regardless of index size.

7. **Deployment guide + Docker image**  
   Document systemd unit, Docker Compose configuration with Ollama sidecar, persistent volume for `.gitsema/`, and API key rotation. A `Dockerfile` and `docker-compose.yml` in the repo root would eliminate the largest adoption barrier.

8. **Short-TTL result cache**  
   Cache (query-string → top-k results) with a 60–120 s TTL, invalidated on re-index. Dramatically reduces redundant scoring for AI assistant use cases.

9. **`gitsema doctor` extended pre-flight**  
   Current `doctor` checks DB integrity. Extend it to: verify embedding model accessibility, check index freshness vs HEAD, warn on schema version mismatch, and estimate search latency class (fast/slow/very-slow based on index size + VSS presence).

10. **`SearchResult` discriminated union types**  
    Split `SearchResult` into `FileLevelResult | ChunkLevelResult | SymbolLevelResult` with a `kind` discriminant. Removes 8+ optional fields from the base type and eliminates synthetic blobHash leaks.

11. **LSP go-to-definition + find-references**  
    Complete the two most-used LSP operations. Both can be implemented using the existing symbol index: definition = nearest-symbol embedding match; references = blobs containing the same symbol name + kind within cosine threshold.

12. **Per-repo access control on HTTP server**  
    When multiple repos are registered, allow scoping a `GITSEMA_SERVE_KEY` token to a specific repo ID. Enables team deployments where different users should only see their own repo's results.

---

## 9) Prioritised Implementation Order

### P0 (low effort, high parity value)

1. HTTP routes for Phase 41–47 and Phase 65–70 commands
2. `gitsema status` scale warnings + auto-suggest VSS / early-cut
3. Extended `gitsema doctor` pre-flight checks

### P1 (performance + scale)

4. Route `vectorSearch()` through HNSW index when present (ANN for general search)
5. Bulk path resolution (`WHERE blob_hash IN (...)`) to replace per-result queries
6. Short-TTL result cache (60–120 s)

### P2 (operational readiness)

7. `/metrics` Prometheus endpoint
8. Rate limiting middleware
9. Deployment guide + `Dockerfile` / `docker-compose.yml`
10. OpenAPI spec generation

### P3 (code quality + type safety)

11. `SearchResult` discriminated union types
12. LSP go-to-definition + find-references (or clearly mark as not-yet-implemented)
13. `htmlRenderer.ts` — document generation pipeline or split into modules

---

## 10) Closing Assessment

`gitsema` has a technically differentiated core: content-addressed temporal semantic search over Git history is genuinely novel and useful. The architecture is sound (blob-first, streaming, pluggable providers, composable ranking signals). Schema migrations are disciplined. The test suite covers the critical path.

The next step is not adding more primitives. It is making the existing primitives reliably deployable and discoverable:

- Close the HTTP surface gap (the biggest parity hole)
- Make the tool self-explaining about scale limits
- Give teams a deployment path that doesn't require reading source code
- Add the operational instrumentation needed to run it as a shared service

The gap between "impressive feature catalog" and "tool a team deploys with confidence" is now operational polish, not architecture.
