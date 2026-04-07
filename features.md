# gitsema — Feature Catalog

> Current version: **v0.70.0** · Schema: **v17** · Test suite: **~364 tests**
>
> This document is a concise reference for implemented features grouped by area.
> For the full development roadmap and planned phases see [`docs/PLAN.md`](docs/PLAN.md).

---

## Table of Contents

- [Indexing](#indexing)
- [Search](#search)
- [History / Temporal](#history--temporal)
- [Change Detection](#change-detection)
- [Clustering](#clustering)
- [Branch / Merge](#branch--merge)
- [Analysis](#analysis)
- [Visualization (HTML)](#visualization-html)
- [HTTP API Server](#http-api-server)
- [MCP Tools](#mcp-tools)
- [Protocol Servers (tools subcommand)](#protocol-servers-tools-subcommand)
- [Maintenance & DB](#maintenance--db)
- [Configuration](#configuration)
- [Strategic Productization Backlog](#strategic-productization-backlog)
- [Planned / In Progress](#planned--in-progress)

---

## Indexing

All indexing is **content-addressed**: a blob (file snapshot) is embedded exactly once per SHA-1 hash, regardless of how many commits or paths reference it.

| Feature | Flag / command |
|---|---|
| Full history index | `gitsema index` |
| **Incremental** (default when run after prior index) | `--since <ref|date|"all">` |
| Parallel embedding | `--concurrency <n>` (default 4) |
| Batch embedding requests | `--embed-batch-size <n>` |
| Extension filter | `--ext ".ts,.py"` |
| Path exclusion | `--exclude "node_modules,dist"` |
| Max blob size cap | `--max-size 200kb` |
| Glob-based selective indexing | `--include-glob "src/**"` |
| Specific file indexing from HEAD | `--file <paths...>` |
| Chunking strategies | `--chunker file|function|fixed` |
| Fixed-window chunk tuning | `--window-size <n>`, `--overlap <n>` |
| VSS / HNSW index build after indexing | `--auto-build-vss [threshold]` |
| Int8 scalar quantization | `--quantize` |
| Cap commits per run | `--max-commits <n>` |
| Mixed-model index guard | `--allow-mixed` |
| Index bundle export / import | `gitsema index export/import` |
| Automated hooks (post-commit, post-merge) | `gitsema config set hooks.enabled true` |
| Module-level embeddings (directory centroids) | `gitsema update-modules` |
| Remote-repo indexing via HTTP server | `gitsema remote-index <url>` |
| Multi-repo registry | `gitsema repos add/list/remove` |
| **Profile presets (Phase 63)** | `--profile speed\|balanced\|quality` |
| **Auto-batch detection (Phase 63)** | Auto-enables `embedBatch()` when provider supports it |
| **Adaptive batch controller (Phase 63)** | In-flight batch size adjustment based on observed latency |
| **Post-run maintenance recommendations (Phase 63)** | VSS, FTS backfill, vacuum suggestions after each run |
| **BatchingProvider sub-batch chunking (Phase 62)** | Transparent sub-batch split + retry wrapper for any provider (`buildBatchingProvider()`) |
| **Ollama true-batch endpoint (Phase 62)** | `OllamaProvider` uses `/api/embed` (Ollama ≥ 0.1.34) for native `string[]` batch; falls back to serial on 404 |
| **Pipelined read/embed/store (Phase 69)** | `AsyncQueue`-based overlap of batch stages; activated on the batch path |
| Per-repo project metadata | `gitsema project` (2D projections) |

**Chunking fallback chain:** whole-file → function boundaries → fixed windows (1500 chars) → fixed windows (800 chars) when a blob exceeds the embedding model's context limit.

---

## Search

All search uses the **text embedding model** (not the code model) to embed queries (natural language is the common case).

| Feature | Flag / command |
|---|---|
| Vector similarity search | `gitsema search <query>` |
| Top-k results | `-k / --top <n>` |
| Symbol / chunk-level code search | `gitsema code-search <query>` |
| Hybrid search (vector + BM25) | `--hybrid`, `--bm25-weight <n>` |
| Query expansion (BM25 keywords pre-embedding) | `--expand-query` |
| Recency-blended ranking | `--recent`, `--alpha <n>` |
| Three-signal ranking | `--weight-vector`, `--weight-recency`, `--weight-path` |
| Date range filter | `--before <date>`, `--after <date>` |
| Branch-scoped search | `--branch <name>` |
| Group results | `--group file|module|commit` |
| Include chunk results | `--chunks` |
| Contrastive / negative-example search | `--not-like <query>` |
| Lambda contrastive parameter | `--lambda <n>` |
| Result explanation | `--explain` |
| Boolean queries | `--or`, `--and`; inline `A AND B` / `A OR B` |
| LLM narrative summary | `--narrate` (requires `GITSEMA_LLM_URL`) |
| HNSW approximate-nearest-neighbor search | `--vss` (requires built VSS index) |
| HTML output | `--html [file]` |
| Multi-repo search | `gitsema repos` + MCP `multi_repo_search` |
| **Early-cut (Phase 64)** | `--early-cut <n>` — random-sample candidate pool for speed on large indexes |
| **LLM provenance citations (Phase 64)** | `--explain-llm` — structured citation block for LLM prompt grounding |

---

## History / Temporal

| Feature | Flag / command |
|---|---|
| Find concept origin (first-seen chronologically) | `gitsema first-seen <query>` |
| Single-file semantic drift timeline | `gitsema file-evolution <path>` |
| Concept drift timeline across history | `gitsema evolution <query>` |
| Semantic diff between two refs | `gitsema diff <ref1> <ref2> <query>` |
| Semantic diff of a file between two refs | `gitsema file-diff <ref1> <ref2> <path>` |
| Per-block nearest-neighbor attribution | `gitsema blame <file>` (alias: `semantic-blame`) |
| Concept lifecycle (birth, growth, plateau, decay) | `gitsema lifecycle <query>` |
| Semantic bisect (find regressions) | `gitsema bisect <good> <bad> <query>` |
| Dead-concept detection (deleted blobs) | `gitsema dead-concepts` |
| Evolution alerts (largest jumps) | `--alerts [n]` on `file-evolution` |
| Structured JSON / HTML dump | `--dump [file]`, `--html [file]` *(legacy; prefer `--out`)* |
| Include stored content in dumps | `--include-content` |
| LLM narrative | `--narrate` on `evolution`, `diff`, `file-evolution` |
| **Unified output system (Phase 70)** | `--out <format>[:<file>]` (repeatable) on `search`, `evolution`, `triage`, `policy check`, `ownership`, `workflow run`; formats: `text\|json\|html\|markdown\|sarif` |

---

## Change Detection

| Feature | Flag / command |
|---|---|
| Concept-level change points across history | `gitsema change-points <query>` |
| Single-file semantic change points | `gitsema file-change-points <path>` |
| Cluster-structure change points | `gitsema cluster-change-points` |
| Threshold tuning | `--threshold <n>` (cosine distance, default 0.3) |
| Show top-N jumps | `--top-points <n>` |
| Date range | `--since <ref>`, `--until <ref>` |
| Commit cap (for large repos) | `--max-commits <n>` on `cluster-change-points` |
| Structured JSON dump | `--dump [file]` |
| LLM narrative | `--narrate` |

---

## Clustering

| Feature | Flag / command |
|---|---|
| K-means cluster snapshot | `gitsema clusters` |
| Temporal cluster diff (two refs) | `gitsema cluster-diff <ref1> <ref2>` |
| Multi-step cluster timeline | `gitsema cluster-timeline` |
| Number of clusters | `--k <n>` (default 8) |
| Timeline steps | `--steps <n>` |
| Date range | `--since <ref>`, `--until <ref>` |
| HTML interactive output | `--html [file]` |
| LLM narrative | `--narrate` |
| HNSW warm-start k-means | built into `build-vss` pipeline |

---

## Branch / Merge

| Feature | Flag / command |
|---|---|
| Branch semantic summary vs base | `gitsema branch-summary <branch>` |
| Semantic collision detection before merge | `gitsema merge-audit <branch-a> <branch-b>` |
| Pre-merge concept landscape preview | `gitsema merge-preview <branch>` |
| Cherry-pick suggestions based on semantic similarity | `gitsema cherry-pick-suggest <query>` |
| CI diff (post to PR as GitHub review comment) | `gitsema ci-diff --github-token <token>` |
| Branch filter on search/evolution | `--branch <name>` |

---

## Analysis

| Feature | Flag / command |
|---|---|
| Semantic authorship attribution | `gitsema author <query>` |
| Cross-module coupling / refactor impact | `gitsema impact <path>` |
| Refactor candidates (cross-cutting duplication) | `gitsema refactor-candidates` |
| Documentation gap analysis | `gitsema doc-gap` |
| Contributor profile (per-author concept map) | `gitsema contributor-profile <author>` |
| Security scan (vulnerability pattern similarity) | `gitsema security-scan` (results are similarity scores, not confirmed CVEs) |
| Health timeline (churn rate, dead-concept ratio) | `gitsema health` |
| Technical debt scoring (isolation, age, frequency) | `gitsema debt` |
| **Experts / reviewer suggestions (Phase 61)** | `gitsema experts` |
| **Semantic PR report (Phase 61)** | `gitsema pr-report` |
| **Retrieval evaluation harness (Phase 64)** | `gitsema eval <file.jsonl>` |
| **Incident triage bundle (Phase 65)** | `gitsema triage <query> [--ref1] [--ref2] [--file] [--top] [--dump]` |
| **Policy checks for CI (Phase 66)** | `gitsema policy check [--max-drift] [--max-debt-score] [--min-security-score] [--query]` |
| **Ownership heatmap by concept (Phase 67)** | `gitsema ownership <query> [--top] [--window] [--dump]` |
| **Workflow templates (Phase 68)** | `gitsema workflow run <pr-review\|incident\|release-audit> [--format] [--dump]` |

---

## Visualization (HTML)

Interactive single-file HTML outputs; no external dependencies required.

| Renderer | Command(s) |
|---|---|
| Evolution / concept-evolution timeline | `gitsema evolution --html` |
| Cluster snapshot | `gitsema clusters --html` |
| Cluster diff | `gitsema cluster-diff --html` |
| Cluster timeline | `gitsema cluster-timeline --html` |
| Search results | `gitsema search --html` |
| Author attribution | `gitsema author --html` |
| First-seen results | `gitsema first-seen --html` |
| Impact heatmap | `gitsema impact --html` |
| Semantic diff | `gitsema diff --html` |
| Codebase map (2D scatter) | `gitsema map` |
| Temporal heatmap | `gitsema heatmap` |
| Web UI (served inline) | `gitsema tools serve --ui` |

---

## HTTP API Server

Start with `gitsema tools serve [--port n] [--key token] [--ui]`.

| Route prefix | Endpoints |
|---|---|
| `GET /api/v1/status` | Index statistics |
| `POST /api/v1/blobs/check` | Check if blobs are already indexed |
| `POST /api/v1/blobs` | Write blob + embedding |
| `POST /api/v1/commits`, `POST /api/v1/commits/mark-indexed` | Commit metadata |
| `POST /api/v1/search`, `POST /api/v1/search/first-seen` | Search |
| `POST /api/v1/evolution/file`, `POST /api/v1/evolution/concept` | Evolution |
| `POST /api/v1/remote/index` | Remote repo indexing |
| `GET /api/v1/remote/jobs/metrics`, `GET /api/v1/remote/jobs/:id/progress` | Job progress |
| `POST /api/v1/analysis/clusters` | Clustering |
| `POST /api/v1/analysis/change-points` | Change-point detection |
| `POST /api/v1/analysis/author` | Author attribution |
| `POST /api/v1/analysis/impact` | Impact analysis |
| `POST /api/v1/analysis/semantic-diff` | Semantic diff |
| `POST /api/v1/analysis/semantic-blame` | Semantic blame |
| `POST /api/v1/analysis/dead-concepts` | Dead-concept detection |
| `POST /api/v1/analysis/merge-audit` | Merge audit |
| `POST /api/v1/analysis/merge-preview` | Merge preview |
| `POST /api/v1/analysis/branch-summary` | Branch summary |
| `POST /api/v1/analysis/experts` | Experts / reviewer suggestions (Phase 61) |
| `GET /api/v1/capabilities` | Capabilities manifest (Phase 64) |
| `GET /ui` | Embedded 2D codebase map UI (requires `--ui` flag) |
| `GET /metrics` | Prometheus metrics scrape endpoint (P2) |
| `GET /openapi.json` | OpenAPI 3.1 JSON specification (P2) |
| `GET /docs` | Swagger UI (P2) |

Authentication: optional Bearer token via `--key <token>` / `GITSEMA_SERVE_KEY`.

### Operational features (P2)

- **Prometheus metrics** (`GET /metrics`): exposes HTTP latency histograms, index size gauges, embedding error counters, query cache hit/miss counters, and Node.js default metrics. Protected by auth by default; set `GITSEMA_METRICS_PUBLIC=1` to allow unauthenticated scraping.
- **Rate limiting**: per-token when auth is enabled, per-IP otherwise. Returns `429 Too Many Requests` with `Retry-After` header. Configure via `GITSEMA_RATE_LIMIT_RPM` (default 300) and `GITSEMA_RATE_LIMIT_BURST`.
- **OpenAPI spec** (`GET /openapi.json`): machine-readable OpenAPI 3.1 spec generated from Zod route schemas.
- **Swagger UI** (`GET /docs`): interactive API explorer loaded from CDN.
- **Deployment guide**: [`docs/deploy.md`](docs/deploy.md) covers systemd, Docker/Ollama sidecar, secrets, backups, model rotation, and recommended settings.

---

## MCP Tools

Start with `gitsema tools mcp`. All tools share the same core logic as the CLI.

| Tool name | Description |
|---|---|
| `semantic_search` | Vector similarity search |
| `code_search` | Symbol / chunk-level code search |
| `search_history` | Vector search enriched with Git history metadata |
| `first_seen` | Find when a concept first appeared (chronological sort) |
| `evolution` | Single-file semantic drift timeline |
| `concept_evolution` | Concept drift across codebase history |
| `index` | Trigger incremental (or full) re-indexing |
| `branch_summary` | Semantic summary of a branch vs base |
| `merge_audit` | Detect semantic collisions between two branches |
| `merge_preview` | Predict concept-landscape shift after merge |
| `clusters` | K-means cluster snapshot |
| `change_points` | Concept-level change-point detection |
| `semantic_diff` | Conceptual diff across two git refs |
| `semantic_blame` | Semantic origin of each logical block |
| `file_change_points` | Change points for a single file |
| `cluster_diff` | Compare cluster snapshots at two refs |
| `cluster_timeline` | Multi-step cluster drift timeline |
| `author` | Authorship attribution for a concept |
| `impact` | Cross-module coupling / refactor-impact analysis |
| `dead_concepts` | Find deleted semantic blobs |
| `security_scan` | Vulnerability-pattern similarity scan |
| `health_timeline` | Time-bucketed codebase health metrics |
| `debt_score` | Technical debt scoring |
| `multi_repo_search` | Search across multiple registered gitsema repos |

---

## Protocol Servers (`tools` subcommand)

| Subcommand | Description |
|---|---|
| `gitsema tools mcp` | MCP stdio server (preferred entry point for AI clients) |
| `gitsema tools lsp [--tcp <port>]` | LSP semantic hover server (JSON-RPC over stdio or TCP) |
| `gitsema tools serve [--port n] [--key token] [--ui]` | HTTP API server |

> Legacy top-level aliases `gitsema mcp`, `gitsema lsp`, and `gitsema serve` still work but emit a deprecation warning.

---

## Maintenance & DB

| Feature | Command |
|---|---|
| Index statistics | `gitsema status [file]` |
| DB integrity check | `gitsema doctor` |
| SQLite VACUUM + ANALYZE | `gitsema vacuum` |
| Garbage-collect orphan embeddings | `gitsema gc` |
| Rebuild FTS5 index | `gitsema rebuild-fts` |
| Backfill FTS5 content for pre-Phase-11 blobs | `gitsema backfill-fts` |
| Build / rebuild HNSW VSS index | `gitsema build-vss` |
| Remove embeddings for a specific model | `gitsema clear-model <model>` |
| Recalculate module-level embeddings | `gitsema update-modules` |
| Export index bundle (tar.gz) | `gitsema index export` |
| Import index bundle | `gitsema index import` |
| Saved semantic watches | `gitsema watch add/list/remove/run` |

---

## Configuration

Persistent configuration lives in `.gitsema/config.json` (repo-level) or `~/.config/gitsema/config.json` (global, `--global`).

```bash
gitsema config set provider http
gitsema config set model text-embedding-3-small
gitsema config set index.concurrency 8
gitsema config set hooks.enabled true   # auto-install git hooks
gitsema config list                     # show all active values + sources
```

Environment variables always override config-file values. See [`README.md`](README.md) for the full env-var reference.

---

## Strategic Productization Backlog

Detailed rationale is documented in [`docs/review4.md`](docs/review4.md). High-value productizations proposed from the current codebase:

1. ~~Add `experts` parity to MCP and HTTP (`/analysis/experts` + MCP tool).~~ ✅ Phase 61
2. ~~Add a machine-readable capabilities manifest across CLI/MCP/HTTP.~~ ✅ Phase 64
3. ~~Add pipelined batch indexing (overlap read/embed/store stages).~~ ✅ Phase 69 (`AsyncQueue`-based pipeline)
4. ~~Add speed/quality/balanced search profile presets.~~ ✅ Phase 63
5. ~~Add top-K early-cut scoring mode for large candidate sets.~~ ✅ Phase 64
6. ~~Add semantic PR report generation for CI and code review.~~ ✅ Phase 61 (`gitsema pr-report`)
7. ~~Add incident triage bundles (`bisect` + `change-points` + `first-seen`).~~ ✅ Phase 65 (`gitsema triage`)
8. ~~Add concept ownership heatmap and ownership-shift tracking.~~ ✅ Phase 67 (`gitsema ownership`)
9. ~~Add policy-style CI gates for drift/debt/security thresholds.~~ ✅ Phase 66 (`gitsema policy check`)
10. ~~Add AI-oriented provenance explain mode for prompt grounding.~~ ✅ Phase 64 (`--explain-llm`)
11. ~~Add saved workflow templates (`pr-review`, `incident`, `release-audit`).~~ ✅ Phase 68 (`gitsema workflow run`)
12. ~~Add retrieval quality evaluation harness for AI workflows.~~ ✅ Phase 64 (`gitsema eval`)

All 12 original productization proposals from review4 are now shipped. See [`docs/review5.md`](docs/review5.md) for the next set of priorities.

---

## Planned / In Progress

This section is intentionally brief. The canonical roadmap is in [`docs/PLAN.md`](docs/PLAN.md).

Key areas still in progress or planned (see [`docs/review5.md`](docs/review5.md) for full analysis):

- **HTTP route coverage**: Phase 41–47 and Phases 65–70 analysis commands (`security-scan`, `health`, `debt`, `doc-gap`, `contributor-profile`, `triage`, `policy check`, `ownership`, `workflow`, `eval`) have no HTTP API routes yet. CLI and MCP parity exists; HTTP is the gap.
- **HNSW for general search**: The VSS/HNSW index (used by clustering) is not yet wired into general `vectorSearch()`. Doing so would cap query latency regardless of index size.
- ~~**OpenAPI spec**: No OpenAPI spec yet.~~ ✅ **Done (P2)**: `GET /openapi.json` (OpenAPI 3.1) and `GET /docs` (Swagger UI) are now live.
- ~~**Observability**: No `/metrics` endpoint.~~ ✅ **Done (P2)**: Prometheus metrics at `GET /metrics` with histograms, gauges, and counters.
- ~~**Rate limiting**: HTTP server has optional auth but no per-token or per-IP rate limiting.~~ ✅ **Done (P2)**: `express-rate-limit` with per-token or per-IP windowing; `GITSEMA_RATE_LIMIT_RPM` env var.
- ~~**Deployment documentation**: No guide for persistent service deployment.~~ ✅ **Done (P2)**: See [`docs/deploy.md`](docs/deploy.md) — systemd, Docker/Ollama, secrets, backups, model rotation.
- **LSP completeness**: `gitsema tools lsp` handles hover only; `go-to-definition`, `find-references`, and `document-symbol` are stubs. Not production-ready.
- **Scale warnings in `gitsema status`**: No guidance when index size will cause slow searches (recommend `--early-cut` or `build-vss`).
- **Result caching**: Query embedding is cached; search results are not. Short-TTL result cache would reduce load for AI assistant use cases.
- **GPU-accelerated local embeddings**: Xenova/Transformers.js local-inference provider for offline use without Ollama.

For the full list of planned phases and backlog items, see [`docs/PLAN.md`](docs/PLAN.md).
