# gitsema — Feature Catalog

> Current version: **v0.96.0** · Schema: **v32** · Test suite: **1380 tests**
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

One database can hold embeddings from **multiple embedding models simultaneously**. Each embedding row is attributed to its embedding config via the `embed_config` table.

| Feature | Flag / command |
|---|---|
| **Index coverage status** (read-only, multi-model aware) | `gitsema index` |
| **Start indexing** (HEAD-first, then history) | `gitsema index start` |
| **Incremental** (default when run after prior index) | `gitsema index start --since <ref|date|"all">` |
| Parallel embedding | `--concurrency <n>` (default 4) |
| Batch embedding requests | `--embed-batch-size <n>` |
| Extension filter | `--ext ".ts,.py"` |
| Path exclusion | `--exclude "node_modules,dist"` |
| Max blob size cap | `--max-size 200kb` |
| Glob-based selective indexing | `--include-glob "src/**"` |
| Specific file indexing from HEAD | `--file <paths...>` |
| Chunking strategies | `--chunker file|function|fixed` |
| **Per-model saved level as chunker/search-level fallback (Phase 77 Goal #4)** | `gitsema models add <name> --level <level>` sets a default granularity for a model; `index start` and `search` now apply it as a fallback when no explicit `--chunker`/`--level`/`--profile` is passed. `index start` skips the fallback rather than guessing if `--text-model`/`--code-model` have conflicting saved levels (one chunker per run). `search` consults both models too, but since its file/chunk/symbol/module search is additive (one call already merges all requested granularities into one ranked pool), a disagreement there searches **both** requested levels instead of picking one |
| Fixed-window chunk tuning | `--window-size <n>`, `--overlap <n>` |
| VSS / HNSW index build after indexing | `--auto-build-vss [threshold]` |
| Int8 scalar quantization | `--quantize` |
| Cap commits per run | `--max-commits <n>` |
| Mixed-model index guard | `--allow-mixed` |
| Model override for a run | `--model <name>` |
| Index bundle export / import | `gitsema index export/import` |
| Automated hooks (post-commit, post-merge) | `gitsema config set hooks.enabled true` |
| Module-level embeddings (directory centroids) | `gitsema index update-modules` |
| Remote-repo indexing via HTTP server | `gitsema remote-index <url>` |
| Multi-repo registry | `gitsema repos add/list/remove` |
| **Profile presets (Phase 63)** | `--profile speed\|balanced\|quality` |
| **Auto-batch detection (Phase 63)** | Auto-enables `embedBatch()` when provider supports it |
| **First-run CPU profiling** | Enabled by `GITSEMA_PROFILE_FIRST_RUN` or `index.profileFirstRun` (default: true). Profiles written to `.gitsema/profiles/embedeer-profile-<timestamp>.cpuprofile`. Precedence: env `GITSEMA_PROFILE_FIRST_RUN` overrides repo config `index.profileFirstRun`. Recommended: disable in CI by setting `GITSEMA_PROFILE_FIRST_RUN=0` in your CI environment. |
| **Adaptive batch controller (Phase 63)** | In-flight batch size adjustment based on observed latency |
| **Post-run maintenance recommendations (Phase 63)** | VSS, FTS backfill, vacuum suggestions after each run |
| **BatchingProvider sub-batch chunking (Phase 62)** | Transparent sub-batch split + retry wrapper for any provider (`buildBatchingProvider()`) |
| **Ollama true-batch endpoint (Phase 62)** | `OllamaProvider` uses `/api/embed` (Ollama ≥ 0.1.34) for native `string[]` batch; falls back to serial on 404 |
| **Pipelined read/embed/store (Phase 69)** | `AsyncQueue`-based overlap of batch stages; activated on the batch path |
| Per-repo project metadata | `gitsema project` (2D projections) |
| **Structural reference extraction (Phase 106)** | `--graph` — extracts raw, unresolved structural references (imports, calls, `extends`/`implements` heritage) for TS/TSX/JS/Python blobs into `structural_refs`, dedup'd by `blob_hash` (knowledge-graph §3.2; sites only — resolution to definitions is Phase 107+) |
| **Structural knowledge graph (Phase 107)** | `gitsema graph build` — truncate-and-rebuild linking pass: resolves `structural_refs` + `symbols` + `paths` into `graph_nodes` (`file:<path>`, `symbol:<path>#<qname>#<sighash>`, `external:<name>`) and typed `edges` (`contains`, `defines`, `imports`, `calls`, `extends`, `implements`, `references`, `co_change`) with confidence-tier resolution (same-file 1.0 → imported 0.9 → project-wide-unique 0.6 → ambiguous 0.3 → unresolved/external 0); `co_change` edges materialized from `blob_commits` (knowledge-graph §3.3/§4/§5) |

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
| Multi-repo search | `gitsema search --repos <ids>` + MCP `semantic_search`/`first_seen` (`repos`) + HTTP `POST /search`/`POST /search/first-seen` (`repos`, Phase 138) + MCP `multi_repo_search` (dedicated tool) + HTTP `POST /analysis/multi-repo-search` (deprecated alias since Phase 138, see `docs/deprecations.md`) |
| **Early-cut (Phase 64)** | `--early-cut <n>` — random-sample candidate pool for speed on large indexes |
| **LLM provenance citations (Phase 64)** | `--explain-llm` — structured citation block for LLM prompt grounding |
| **Stable symbol identity (Phase 105)** | Symbol-level results (`code_search`, `--chunks` with symbols) carry path-free `qualifiedName` (scope chain, e.g. `Auth.validateToken`), `signature` (normalized param list), `signatureHash`, and `parentQualifiedName`, for TS/TSX/JS/Python; `renderResults()` displays `qualifiedName(signature)`, falling back to `symbolName` for other languages/older rows |
| **Distinct per-level result lists (Phase 136, MCP/HTTP parity Phase 138)** | When 2+ of {chunk, symbol, module} are active at once — e.g. `--chunks --level symbol`, or the Phase 77 Goal #4 model-level-fallback union when the text/code models' saved levels disagree — `search` runs one isolated `vectorSearch()` call per level by default (each with its own topK cutoff) and renders them as separate labeled lists (`== file ==`, `== chunk ==`, etc. in text; a `resultsByLevel` object keyed by level in `--out json`), instead of merging every level into one shared-cutoff ranked list where a weaker level could be crowded out entirely. `--merge-levels` opts back into the pre-Phase-136 single merged list. A single active level (the common case) is unaffected. Since Phase 138, MCP `semantic_search` (`level` now includes `module`; `merge_levels` param) and HTTP `POST /search` (`level`/`mergeLevels`) mirror this — HTTP returns `{ resultsByLevel: {...} }` instead of a flat array when 2+ levels are active (breaking response-shape change, accepted per `docs/parity.md` §4) |
| **Per-level result-list separation for `code-search` (Phase 137)** | `code-search`'s default `--level symbol` isolates the chunk and symbol candidate pools by default instead of merging them into one shared-cutoff ranked list — every default, no-flags `code-search` call was hitting the Phase 136 crowding-out condition unconditionally (unlike `search`'s opt-in multi-level combinations), since `symbol` level always sets both `searchChunks` and `searchSymbols`. CLI renders separate `== file ==`/`== chunk ==`/`== symbol ==` sections (reusing `renderResultsByLevel()`); `--merge-levels` opts back into one merged list. MCP `code_search` and Guide's `code_search` tool adopt the same shape — returning a `results_by_level` object keyed by level instead of a flat `results` array (breaking response-shape change, accepted per `docs/parity.md` §4's parity-over-stability principle); both gained a `merge_levels` param to opt back into the flat shape |
| **Full MCP/HTTP query-shaping parity for `search`/`first-seen` (Phase 138)** | MCP `semantic_search`/HTTP `POST /search` gained the remaining CLI `search` flags previously missing: negative-example scoring (`not_like`/`notLike`, `lambda`), boolean composition (`or`, `and`), `explain`, `explain_llm`/`explainLlm`, `expand_query`/`expandQuery`, `annotate_clusters`/`annotateClusters`, `vss` (now routes through `vectorSearchWithAnn()`), `repos` (multi-repo, results merged into the primary list), per-request `model`/`text_model`/`code_model` (MCP) or `model`/`textModel`/`codeModel` (HTTP) overrides (resolved without mutating server process env, so concurrent requests don't race), `early_cut`/`earlyCut`, and `no_cache`/`noCache`. `first_seen`/`POST /search/first-seen` gained `vss`, `repos`, and the model-override triplet. See `docs/parity.md` §2 |

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
| **Unified output system (Phase 70)** | `--out <format>[:<file>]` (repeatable) on `search`, `evolution`, `triage`, `policy-check`, `ownership`, `workflow run`; formats: `text\|json\|html\|markdown\|sarif` |
| **Unified --out coverage (Phase 95)** | `--out` now also available on every command that previously had only `--dump`/`--html`/`--format` (e.g. `experts`, `author`, `clusters`, `cluster-diff`, `cluster-timeline`, `change-points`, `file-change-points`, `cluster-change-points`, `branch-summary`, `merge-audit`, `merge-preview`, `impact`, `dead-concepts`, `blame`, `debt`, `eval`, `regression-gate`, `cross-repo-similarity`, `code-review`); legacy flags remain functional and are annotated "legacy: prefer --out ..." |
| **Canonical --since/--until (Phase 95)** | `gitsema search` accepts `--since`/`--until` as documented aliases of `--after`/`--before` (YYYY-MM-DD or ISO 8601), matching the `--since`/`--until` convention used elsewhere in the CLI |
| **`evolution`/`hotspots` HTTP route parity (Phase 139)** | `POST /evolution/file` gains `level: 'symbol'` (per-symbol centroid drift, mirroring `--level symbol`), `branch`, `model`/`textModel`/`codeModel` overrides, and an `alerts: <n>` field returning the same author/commit-URL-enriched top-N largest-jump list as CLI's `--alerts`. `POST /evolution/concept` gains `branch` and `model`/`textModel`/`codeModel` overrides. Both routes now thread `branch` into the core `computeEvolution()` function itself (previously CLI-only, via post-filtering) — `computeConceptEvolution()` already accepted it. `POST /graph/hotspots` gains `weightStructural` for flag-surface parity with CLI's `--weight-structural` (`addLensOption`); like the CLI, it is currently a no-op since `computeHotspots()`'s risk score is an unweighted geometric mean with no weighting hook. `--narrate` on these three routes is deferred — LLM/infra-adjacent, tracked as a possible follow-up alongside Phase 144's narrator-route work rather than folded in here |

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
| **Policy checks for CI (Phase 66)** | `gitsema policy-check [--max-drift] [--max-debt-score] [--min-security-score] [--query]` — exit codes: 0 = ok, 1 = runtime error, 2 = usage error, 3 = gate failed |
| **Ownership heatmap by concept (Phase 67)** | `gitsema ownership <query> [--top] [--window] [--dump]` |
| **Workflow templates (Phase 68)** | `gitsema workflow run <pr-review\|incident\|release-audit> [--format] [--dump]` |
| **LLM narration / explanation / guide (Phase 96)** | `gitsema narrate [options]`, `gitsema explain <topic> [options]`, `gitsema guide [question] [options]` — safe-by-default (evidence-only, no network) unless a narrator/guide model is configured via `gitsema models add <name> --narrator\|--guide --http-url <url> --activate`; all LLM payloads pass through secret/PII redaction |
| **Guide agentic tool-calling loop (Phase 96/97)** | `gitsema guide` runs a `@jsilvanus/chattydeer` `runAgentLoop` (maxRoundtrips 5) against the full `GUIDE_TOOLS` registry in `src/core/narrator/guideTools.ts` — ~36 capabilities spanning repo/search/history/branch/ownership/quality/diff/clusters/workflow/admin (the same set exposed as MCP tools); `-i/--interactive` reuses one agent session across turns. Index-gated tools return `{error}` gracefully when no `.gitsema` index exists |
| **Tool interpretation registry (Phase 97)** | `src/core/narrator/interpretations.ts` is the single source of truth for how to read each tool's output (result shape, thresholds, caveats). Feeds the guide's system prompt (`buildGuideToolCatalog()`), the `narrate`/`explain`/result-narration system prompts (`buildNarratorSystemPrompt(name)`), and the generated "Interpreting gitsema tool results" section of `skill/gitsema-ai-assistant.md` (`pnpm gen:skill`, drift-checked by `tests/docsSync.test.ts`) |
| **CLI-based AI tool backends (Phase 98)** | `gitsema models add <name> --narrator\|--guide --provider cli --cli-command <tool> [--cli-args "<args>"] [--use-mcp] --activate` configures a local CLI AI coding agent (Claude Code, Codex CLI, GitHub Copilot CLI, or any other tool) as the narrator/guide backend instead of an HTTP endpoint. `narrate`/`explain` shell out to the tool one-shot (`<tool> -p "<prompt>"`, redacted, captured from stdout). `guide --provider cli --use-mcp` additionally writes a temporary MCP config exposing gitsema's own `tools mcp` server and passes `--mcp-config`/`--allowedTools mcp__gitsema__*`, so the CLI tool's own agent loop calls gitsema's analysis tools directly; multi-turn `-i/--interactive` sessions are kept coherent via the tool's session-resume flag (e.g. Claude Code's `--resume <id>`). Per-tool adapters live in `src/core/narrator/cliAdapters.ts` (built-in: `claude`, `codex`, `copilot`/`gh`, plus a generic fallback for any other executable); Codex MCP support is best-effort/experimental and Copilot CLI is one-shot only (no MCP/session support) |
| **Ollama provider for narrator/guide + model discovery (Phase 99)** | `gitsema models add <name> --narrator\|--guide --provider ollama [--global-name <tag>] --activate` configures a local Ollama model as the LLM backend, defaulting `--http-url` to `http://localhost:11434` and sending the correct `model` field (the local name, or `--global-name` if the alias differs from the Ollama tag) to `/v1/chat/completions`. `gitsema models add [name]` — for embedding, narrator, or guide — now accepts an optional `<name>`: when omitted (and the provider is, or defaults to, `ollama`), gitsema queries Ollama's `/api/tags` and lists locally available models instead of erroring |
| **Full-toolset guide coverage (Phase 104)** | `GUIDE_TOOLS`/`TOOL_INTERPRETATIONS` now cover `bisect`, `refactor-candidates`, `cherry-pick-suggest`, `heatmap`, `map`, `file-diff`, `lifecycle`, `cluster-change-points`, `cross-repo-similarity`, and `pr-report`, so `gitsema guide` and the generated skill can reason about the full CLI command surface |
| **Generic `--narrate` via `narrateToolResult` (Phase 104)** | `narrateToolResult(toolKey, result)` in `src/core/llm/narrator.ts` looks up the tool's `TOOL_INTERPRETATIONS` entry, redacts and caps the JSON result, and asks the active narrator model for a prose summary (safe-by-default — no network unless `--narrate` is passed and a narrator model is configured). Wired onto `--narrate` flags on `first-seen`, `branch-summary`, `merge-audit`, `merge-preview`, `dead-concepts`, `debt`, `doc-gap`, `security-scan`, `blame`/`semantic-blame`, `triage`, `impact`, `ownership`, `experts`, `author`, `contributor-profile`, `bisect`, `refactor-candidates`, `cherry-pick-suggest`, and `heatmap` |
| **Guided `gitsema setup` wizard with storage backend selection (Phase 104)** | `gitsema setup` (primary name; `gitsema quickstart` remains a backward-compat alias) extends the onboarding wizard with a storage-backend step (sqlite/postgres/qdrant), persisting `storage.*` config keys and validating the connection via `getCachedStorageProfile().metadata.getLastIndexedCommit()` (reverting to sqlite on failure), plus an optional final step to configure a local Ollama narrator/guide model via `gitsema models add <name> --narrator\|--guide --provider ollama --activate` |
| **Co-change / dependency / cycle queries (Phase 107)** | `gitsema co-change <path> [-k/--top]` — files that historically change together with `<path>` (from `co_change` edges); `gitsema deps <identifier> [--reverse] [--depth] [--edge-types]` — import/dependency closure of a file or symbol (BFS over `imports`/`calls`/`extends`/`implements` edges); `gitsema graph cycles` / top-level `gitsema cycles [--edge-types]` — detect cycles in the structural graph (default: `imports`). All require `gitsema index --graph` + `gitsema graph build` first |
| **Graph traversal primitives (Phase 108)** | `GraphStore.neighbors/callers/callees/path/subgraph` — recursive-CTE traversals over `graph_nodes`/`edges` (sqlite + Postgres; Qdrant profile throws "graph queries require a relational backend"), depth capped at 3. CLI: `gitsema graph callers <symbol> [--depth]` (reverse `calls` traversal), `gitsema graph callees <symbol> [--depth]` (forward `calls` traversal), `gitsema graph neighbors <node> [--edge-types] [--direction] [--depth]` (typed neighborhood, any edge kinds), `gitsema graph path <a> <b>` (shortest typed path, rendered as `-[edgeType]->`/`<-[edgeType]-` hops). MCP: `call_graph` (callers/callees) and `graph_neighbors`. All resolve symbol qualified names, file paths, or literal node keys via `resolveNode()`; require `gitsema index --graph` + `gitsema graph build` first |
| **`--lens` toggle + four-signal ranking (Phase 109)** | `vectorSearch` gains a fourth ranking signal — `weightStructural`/`structuralScores` extend the three-signal formula to `score = (wv*cosine + wr*recency + wp*pathScore + ws*structScore) / wTotal`, where `structScore` is `1 / (1 + hops)` graph proximity from a query anchor. Unset by default (byte-for-byte identical to pre-Phase-109 ranking). Shared `--lens semantic\|structural\|hybrid` + `--weight-structural <n>` CLI options (`src/cli/lib/lens.ts`) toggle which signal(s) drive a command's output |
| **Structural/semantic fusion commands (Phase 109)** | `gitsema blast-radius <symbol> [--lens] [--depth] [-k/--top]` (default: hybrid) — "what changes if I touch this": structural dependents (`calls`/`imports`/`extends`/`implements`/`references`, reverse traversal) and/or semantically similar blobs/symbols; `gitsema relate <symbol> [--lens] [-k/--top]` (default: hybrid) — depth-1 callers + depth-1 callees (labeled) plus semantically similar blobs/symbols; `gitsema similar <symbol> [--lens] [-k/--top]` (default: hybrid) — structural similarity via Jaccard overlap of outgoing edge targets (same call/import "shape") and/or semantic embedding similarity; `gitsema unused [--edge-types]` — file/function/class/method nodes with no inbound `calls`/`imports` edges, the structural complement to `dead-concepts`. Semantic ranking (`semanticNeighborsForNode`) uses already-stored embeddings — no embedding provider call — and degrades to `(not supported on this storage backend)` on non-sqlite backends. `gitsema impact <path> --lens structural\|hybrid` becomes a thin alias over `blast-radius`; `--lens semantic` (default) is unchanged |
| **Cascade query planner (Phase 110)** | `planCascade()` (`src/core/graph/cascade.ts`) — the four-stage fusion pipeline behind the `hybrid` lens for query-driven commands: **FTS filter** (BM25 pre-filter) → **vector expand** (cosine) → **graph traversal** (map top semantic hits to `file` nodes, expand along `calls`/`imports`/`extends`/`implements`/`references` edges) → **merge/rerank** (lens-weighted blend; every hit labeled with the contributing lens[es]). `lens: 'semantic'` short-circuits to the plain vector ranking (byte-identical); structural stages degrade to semantic-only on non-relational backends (`structuralSupported: false`) |
| **`hotspots` — architectural risk (Phase 110)** | `gitsema hotspots [--lens] [-k/--top]` (default: hybrid), MCP `hotspots`, and `POST /api/v1/graph/hotspots` — ranks files by `risk = co-change (temporal) × call-coupling (structural) × churn`, a geometric mean of the normalized signals the lens selects (`hybrid` = all three, `structural` = coupling only, `semantic` = co-change × churn). Co-change/coupling come from the graph; churn from `blob_commits` (`churnByPath()`, sqlite). Each hit is labeled with the contributing lens[es] |
| **Structural enrichment of fusion commands (Phase 110)** | `code-review`, `triage`, `explain`, and `guide` gain `--lens`: under `structural`/`hybrid` they surface grounded call-graph/co-change context (`structuralContextForPath()` — "N callers, co-changes with X 80%", and for triage the cascade planner). `--lens semantic` (default) leaves output byte-for-byte unchanged. New guide/MCP tools `call_graph`, `blast_radius`, `hotspots` let AI agents navigate structurally |
| **Lens coverage & parity sweep (Phase 111)** | Every command where more than one lens is meaningful exposes the shared `--lens` (`addLensOption()`), with §7.3 defaults enforced uniformly (existing → `semantic`, graph-native → `structural`, fusion → `hybrid`) and per-hit lens labeling across text/JSON renderers. A mechanical parity test (`tests/lensParity.test.ts`, mirroring `docsSync`) introspects the Commander program + GUIDE_TOOLS + MCP/HTTP source to guarantee coverage stays uniform |
| **Unified graph UI — HTML force-graph + CLI subgraph view (Phase 112)** | `gitsema graph neighbors`, `gitsema graph path`, `gitsema blast-radius`, `gitsema relate`, `gitsema similar`, and `gitsema hotspots` all gain `--out <spec>` (`text\|json[:file]\|html[:file]\|markdown[:file]`) rendering a shared `RenderableSubgraph` (`src/core/graph/subgraphView.ts`) built from `GraphStore.subgraph()`/the command's own traversal result. `--out html` (`renderGraphHtml()`, `src/core/viz/htmlRenderer-graph.ts`) is an interactive canvas force-graph (reusing the `htmlRenderer-clusters.ts` physics/`safeJson()`/`BASE_CSS` pattern); clicking a node opens a sidebar with its kind/path/risk weight and copyable "suggested commands" (`suggestedCommands()`) deep-linking into other per-command HTML views (e.g. `file-evolution --out html:evolution.html`). `--out text` (`renderGraphTree()`, `src/cli/lib/graphRender.ts`) renders the same subgraph as a cycle-safe indented ASCII tree for terminal-only workflows; `--out markdown` (`renderGraphMarkdown()`) renders a nested bullet list. Passing no `--out` leaves every command's pre-existing default text output unchanged |

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
| `POST /api/v1/search`, `POST /api/v1/search/first-seen` | Search — full CLI `search`/`first-seen` flag parity since Phase 138, including per-level `resultsByLevel` responses and multi-repo `repos` |
| `POST /api/v1/evolution/file`, `POST /api/v1/evolution/concept` | Evolution |
| `POST /api/v1/remote/index` | Remote repo indexing |
| `GET /api/v1/remote/jobs/metrics`, `GET /api/v1/remote/jobs/:id/progress` | Job progress |
| `POST /api/v1/analysis/clusters` | Clustering — accepts `{model, textModel, codeModel}` overrides for CLI/HTTP flag parity (Phase 140), though `computeClusters()` doesn't filter by model so behavior is unchanged today; full `iterations`/`edgeThreshold`/`enhancedKeywordsN` flag parity with the CLI (Phase 143), alongside the pre-existing `useEnhancedLabels` |
| `POST /api/v1/analysis/change-points` | Change-point detection — accepts `{model, textModel, codeModel}` embedding overrides (Phase 140) |
| `POST /api/v1/analysis/author` | Author attribution — full CLI flag parity (Phase 141): `since`, `detail`, `includeCommits`, `hybrid`, `bm25Weight` all wired through, plus `{model, textModel, codeModel}` embedding overrides (Phase 140); response is `{ authors, commits? }` |
| `POST /api/v1/analysis/impact` | Impact analysis — accepts `{model, textModel, codeModel}` embedding overrides (Phase 140); `chunks`/`level` and, most notably, `lens` (`semantic`\|`structural`\|`hybrid`) for full CLI parity (Phase 143) — `structural`/`hybrid` makes this route a thin `blast-radius` alias, closing a prior silent divergence where HTTP only ever did semantic-lens impact analysis |
| `POST /api/v1/analysis/semantic-diff` | Semantic diff — accepts `{model, textModel, codeModel}` embedding overrides (Phase 140); `hybrid`/`bm25Weight` (Phase 143) blend BM25 keyword matching into candidate selection via `hybridSearch()` + `computeSemanticDiff()`'s new `candidateBlobs` parameter — this also fixed a pre-existing CLI bug where `diff`'s `--hybrid`/`--bm25-weight` flags were declared but never wired to anything |
| `POST /api/v1/analysis/semantic-blame` | Semantic blame — accepts `{model, textModel, codeModel}` embedding overrides (Phase 140); `level` (`file`\|`symbol`, Phase 143) as an alternate spelling of the pre-existing `searchSymbols` boolean, matching the CLI's flag surface |
| `POST /api/v1/analysis/dead-concepts` | Dead-concept detection |
| `POST /api/v1/analysis/merge-audit` | Merge audit — `base` (Phase 143) overrides merge-base detection, mirroring CLI `--base` |
| `POST /api/v1/analysis/merge-preview` | Merge preview — `top`/`iterations`/`edgeThreshold`/`enhancedKeywordsN`/`useEnhancedLabels` (Phase 143) for CLI cluster-flag parity |
| `POST /api/v1/analysis/branch-summary` | Branch summary — `enhancedLabels`/`enhancedKeywordsN` (Phase 143) slice `nearestConcepts[].topKeywords` in the JSON response, mirroring the CLI's text-mode keyword-count behavior |
| `POST /api/v1/analysis/experts` | Experts / reviewer suggestions (Phase 61) |
| `POST /api/v1/analysis/security-scan` | Vulnerability pattern similarity scan (Phase 43) — `highConfidenceOnly` (Phase 143) filters to `confidence === 'high'` findings only |
| `POST /api/v1/analysis/health` | Time-bucketed health timeline (Phase 44) |
| `POST /api/v1/analysis/debt` | Technical debt scoring (Phase 45) |
| `POST /api/v1/analysis/doc-gap` | Documentation gap analysis (Phase 38) |
| `POST /api/v1/analysis/contributor-profile` | Contributor semantic profile (Phase 39) |
| `POST /api/v1/analysis/triage` | Incident triage bundle (Phase 65) — accepts `{model, textModel, codeModel}` embedding overrides (Phase 140) |
| `POST /api/v1/analysis/policy-check` | Automated CI gate checks (Phase 66) |
| `POST /api/v1/analysis/ownership` | Ownership heatmap by concept (Phase 67) |
| `POST /api/v1/analysis/workflow` | Workflow template runner — `pr-review \| incident \| release-audit` (Phase 68); accepts `{model, textModel, codeModel}` embedding overrides (Phase 140) |
| `POST /api/v1/analysis/eval` | Inline retrieval evaluation harness — P@k, R@k, MRR (Phase 64) |
| `POST /api/v1/analysis/multi-repo-search` | **Deprecated** (Phase 138) — search across multiple registered repos; use `POST /api/v1/search` with a `repos` body param instead, which merges multi-repo results into the full search flag surface. Kept as a thin unchanged-shape alias, see `docs/deprecations.md` |
| `POST /api/v1/protocol/:operation` | Generic LSP/MCP remote-delegation dispatch — `mcp.<toolName>` runs any of the 38 MCP tools, `lsp.<op>` runs any of the 9 LSP data methods, both via the existing local dispatch (no duplicated logic) (Phase 113; `lsp.codeLens` added Phase 115) |
| `GET /api/v1/capabilities` | Capabilities manifest (Phase 64) |
| `POST /api/v1/auth/login` | Username/password → session token (Phase 122) |
| `POST /api/v1/auth/logout` | Revoke the session token used to call it (Phase 122) |
| `POST /api/v1/auth/tokens`, `GET /api/v1/auth/tokens`, `DELETE /api/v1/auth/tokens/:prefix` | Mint/list/revoke the calling user's API keys (Phase 122) |
| `GET /api/v1/auth/whoami` | Resolve the calling user's identity (Phase 122) |
| `POST /api/v1/orgs`, `GET /api/v1/orgs` | Create a team org / list the calling user's orgs (Phase 123) |
| `POST /api/v1/orgs/:orgId/members`, `DELETE /api/v1/orgs/:orgId/members/:userId` | Add/remove an org member; `org_admin`-only, rejected with 403 on personal orgs (Phase 123) |
| `GET /api/v1/repos/:repoId/grants`, `POST /api/v1/repos/:repoId/grants` | List/create a repo or branch-scoped grant; create requires `owner` role on the repo (Phase 123) |
| `DELETE /api/v1/repos/:repoId/grants/:userId` | Revoke a user's grants on a repo; requires `owner` role (Phase 123) |
| `POST /api/v1/repos/:repoId/move-to-org` | Move a repo to a different org (or back to none); requires `owner` role, grants survive untouched (Phase 123) |
| `GET /api/v1/auth/sso` | List SSO/OIDC identities linked to the calling user (Phase 124) |
| `DELETE /api/v1/auth/sso/:provider/:externalId` | Unlink an SSO/OIDC identity linked to the calling user; 404 if not owned by them (Phase 124) |
| `GET /ui` | Embedded 2D codebase map UI (requires `--ui`) |
| `GET /metrics` | Prometheus metrics scrape endpoint (P2) |
| `GET /openapi.json` | OpenAPI 3.1 JSON specification (P2) |
| `GET /docs` | Swagger UI (P2) |

Authentication: optional Bearer token via `--key <token>` / `GITSEMA_SERVE_KEY`. Per-repo scoped tokens can be minted with `gitsema repos token add <repo-id>` and are stored as **SHA-256 hashes** at rest (review7 §4.1) — the plaintext is never persisted in the database.

### Identity & credentials core (Phase 122)

User accounts (`gitsema auth create-user <username>`, local DB bootstrap; org/role-gated
self-service creation ships in Phase 123) authenticate against `/api/v1/auth/*` via
either a password-derived **session token** (`gitsema auth login <server-url>`, 30-day
idle-window TTL by default, configurable via `GITSEMA_SESSION_TTL_DAYS`) or a long-lived
**API key** (`gitsema auth token create/list/revoke`). Passwords are hashed with
`node:crypto`'s scrypt (no new dependency); session tokens and API keys are stored as
SHA-256 hashes at rest, the same precedent as `repo_tokens` (review7 §4.1) — only an
8-character prefix is kept in the clear for display/revoke-by-prefix lookups. Both
credential kinds resolve to a `userId` in `authMiddleware`, checked **before** the
legacy `GITSEMA_SERVE_KEY` and `repo_tokens` paths on every request. Phase 122 itself
added no authorization changes — orgs, grants, and roles are added in Phase 123 below.
The local credential file (`~/.config/gitsema/credentials.json`, `0o600`) tracks one
active login at a time.

### Orgs & repo grants (Phase 123)

Three-axis authorization model: Axis A is identity (Phase 122's `users`); Axis B is
**membership** — every user belongs to one or more `orgs`, each either `kind: 'personal'`
(auto-provisioned on user creation, exactly one member forever, immutable —
`addOrgMember`/`removeOrgMember` throw `PersonalOrgImmutableError` for personal orgs) or
`kind: 'team'` (explicit, created via `gitsema orgs create <name>` / `POST /api/v1/orgs`,
any membership size, members are `org_admin` or `member`); Axis C is the **grant** — a
`(user_id, repo_id, role, branch_pattern)` row in `repo_grants` giving a user `read` |
`write` | `owner` access to a repo, optionally scoped to a branch glob (`minimatch`,
matching the existing `--include-glob` convention) with `branch_pattern: null` meaning
all branches. `resolveUserRepoAccess` resolves the highest applicable role across a
user's grants for a repo (and optional branch); `roleSatisfies` ranks `owner > write >
read`. Repos carry an optional `org_id`; `gitsema repos move-to-org <repo-id> <org-id>`
(`POST /api/v1/repos/:repoId/grants` sibling route `move-to-org`) reassigns it — grants
are keyed by `(user_id, repo_id)`, not org, so they survive a move untouched. Personal
groups are gated by `auth.personalGroups` / `GITSEMA_PERSONAL_GROUPS` (default `true`).
CLI surface: `gitsema orgs create/list/members add/remove/list`, `gitsema users
create/list`, `gitsema repos grant/grants/revoke/move-to-org` — all operator-tooling
commands that read/write the local server DB directly (`getRawDb()`), the same pattern
as `gitsema auth create-user` and `gitsema repos token *`, not the remote-HTTP-client
pattern used by `gitsema auth login/logout/whoami/token`. Deliberate scope limits (see
`docs/PLAN.md` Phase 123 for the full list): the ~16 pre-existing analysis/search/
evolution/graph HTTP routes are not yet retrofitted to enforce `resolveUserRepoAccess`;
newly created repos do not default into the creator's personal org; and there is no
backfill migration granting pre-existing users a personal org retroactively.

### SSO/OIDC identity linking (Phase 124)

Linking, not replacing — a user keeps their password/API keys alongside any linked
external identity; both resolve to the same `userId`. `sso_identities` maps a
`(provider, external_id)` pair (unique) to a `user_id`. Providers must be explicitly
allowlisted via `auth.ssoProviders` / `GITSEMA_SSO_PROVIDERS` (comma-separated, empty
by default — no provider is allowed until configured). Linking a new identity is
**operator-only**: `gitsema auth sso link <provider> <external-id> <username>` writes
directly to the local server DB, the same precedent as `gitsema auth create-user`
(Phase 122) and `gitsema orgs create` (Phase 123). Self-service is read/delete-only over
HTTP: `GET /api/v1/auth/sso` lists the calling user's own linked identities, and
`DELETE /api/v1/auth/sso/:provider/:externalId` unlinks one of the calling user's own
identities (404 if it isn't linked to them) — linking is deliberately **not** exposed
over HTTP, since without a live OIDC verification flow that would let any authenticated
user claim an arbitrary `external_id`. `gitsema auth sso unlink/list` are also available
as operator commands for managing any user's identities. Deliberate scope deviation
(see `docs/PLAN.md` Phase 124 for detail): this phase ships the linking data model and
CRUD only — it does **not** implement the device-code browser-based OIDC flow
(`gitsema auth login <server-url> --sso <provider>`) from the design doc, since that
requires choosing and integrating an OIDC client library (a new dependency against
CLAUDE.md's minimal-deps preference) and a live identity provider to test against.

### Audit log (Phase 125)

`audit_log` records sensitive identity/authorization actions — grant create/revoke,
token create/revoke, login success/failure, org membership changes, repo org moves —
so they can later be queried by org or repo. The table has **no foreign-key
constraints** on `actor_user_id`/`org_id`/`repo_id`: an audit trail is meant to outlive
the rows it documents (a later-deleted org or revoked grant shouldn't erase the
historical record of having created it). Query via `gitsema audit log [--org <org>]
[--repo <repo-id>] [--limit <n>]`, an operator-only CLI command reading directly from
the local server DB (same precedent as `gitsema orgs *`). Deliberate scope deviation:
only the HTTP routes (`src/server/routes/auth.ts`, `src/server/routes/orgs.ts`) record
audit events — the equivalent operator-only CLI-direct paths (`gitsema repos grant`,
`gitsema orgs members add`, `gitsema auth create-user`, etc.) do **not** get logged in
v1, since those paths already require local DB access, a stronger trust boundary than
the network surface this audit trail is primarily meant to cover.

**Coverage enforcement (Phase 132):** `tests/auditCoverageEnforcement.test.ts`
statically scans every route handler in `src/server/routes/` for calls to known
sensitive-table writer functions (`createUser`, `createSession`/`revokeSession`,
`createApiKey`/`revokeApiKeyByPrefix`, `addOrgMember`/`removeOrgMember`,
`createGrant`/`revokeGrant`/`moveRepoToOrg`, `linkSsoIdentity`/`unlinkSsoIdentity`) and
fails the build if a handler writes to `users`/`sessions`/`api_keys`/`org_members`/
`repo_grants`/`sso_identities` without a `recordAuditEvent()` call in the same handler
body and no documented exemption — so a future sensitive route can no longer silently
ship without audit coverage.

### Public repo sharing (Phases 126–127)

Registration-flow extension layered on top of Phases 122-123's `repo_grants`
model, letting a repo owner opt their persisted repo into shared read access
without minting individual grants by hand. Three axes:
- **Visibility flag** — `repos.visibility` (`'private'` default, `'public'`),
  set via `gitsema repos visibility <repoId> public|private` (operator-only —
  no network auth boundary on this command). `repos.owner_user_id` records the
  first user (or `null` for an operator/no-auth caller) whose registration
  request created the repo; first-claimer semantics are preserved across
  re-indexes — later registration requests never overwrite it.
- **Attach-as-reader auto-grant** — when an authenticated, non-owner caller
  triggers `POST /api/v1/remote/index` against an *existing* `public` repo
  they don't already have a grant on, a `read`-role `repo_grants` row is
  auto-issued for them with `source: 'auto-public'` (distinguishing it from a
  manually issued grant). A caller who already holds a higher role
  (`write`/`owner`) is never downgraded.
- **Trigger rights** — registering a *brand-new* repo as `public` requires
  `auth.allowPublicAutoIndex` / `GITSEMA_PUBLIC_AUTO_INDEX` (default `false`)
  to be enabled, unless the caller is an operator (no `req.userId` — local
  CLI/global-key/no-auth-required request, the same stronger-trust-tier
  precedent established in Phases 122-125). Once a public repo exists,
  non-owner re-index triggers are throttled to at most one per
  `auth.minReindexIntervalSeconds` / `GITSEMA_MIN_REINDEX_INTERVAL_SECONDS`
  (default 300s) per `(user, repo)` pair, returning `429` + `Retry-After`; the
  repo's owner is never throttled.

**Implementation note — two independent databases.** A `gitsema tools serve`
deployment has two separate SQLite files: the cwd-relative active session
(`.gitsema/index.db`, the canonical store for the entire Phase 122-125 auth/
orgs/grants system, resolved by `authMiddleware`) and the registry session
(`${GITSEMA_DATA_DIR}/registry.db`, cwd-independent, tracking persisted-repo
clone/index paths since Phase 41). Both run the full schema with independent
per-file FK enforcement, so an `owner_user_id` valid in one is not
automatically valid in the other. `registry.db` keeps its original sole
purpose and never stores `owner_user_id`; the active DB is the canonical
store for `visibility`/`owner_user_id`/`repo_grants`, kept in sync by a
dual-write in `runIndexJob` after each successful persisted index. See
`docs/PLAN.md`'s Phase 126/127 entry for the full deviation note.

### Multi-profile embedding serving (Phase 128)

A `gitsema tools serve` deployment can offer several named embedding profiles
(provider/model pairs) at once instead of one process-wide model pair.
Profiles are defined via `GITSEMA_EMBEDDING_PROFILES` (JSON array) or the
`embeddingProfiles` config key — each entry is `{name, provider, textModel,
codeModel?, httpUrl?, apiKey?}` — and resolved to their own
`EmbeddingProvider` pair at server startup (`loadEmbeddingProfileConfigs` /
`buildProfileProviderMap` in `src/core/embedding/profiles.ts`).

- **Pin-forever semantics.** `POST /api/v1/remote/index` accepts an optional
  `profileName`. A repo's `repos.profile_name` column is set once, at first
  index, and never overwritten on subsequent re-indexes (same first-claimer
  pattern as `owner_user_id`/`visibility` from Phase 126).
- **Routing rules on `POST /api/v1/remote/index`:** a pinned repo reindexed
  with a mismatched `profileName` gets `409`; a brand-new repo with no
  `profileName` auto-selects the sole configured profile if exactly one
  exists, or `400`s as ambiguous if more than one is configured; an unknown
  `profileName` always `400`s.
- **CLI:** `gitsema remote-index <url> --profile <name>` requests a profile
  by name (pinned forever on that repo's first index). `gitsema repos info
  <repoId>` surfaces the pinned profile for a persisted repo.
- **Backward compatible.** A server with no profiles configured behaves
  exactly as before — a single synthetic `'default'` profile wraps the
  existing process-wide `textProvider`/`codeProvider`.
- **Scope note:** query-time embedding (search/evolution) still always uses
  the server's process-wide text provider, not a per-repo pinned profile's
  provider — see `docs/PLAN.md`'s Phase 128 entry for the deviation note.
- **Ephemeral jobs (Phase 135).** `persist: false` (non-persisted) indexing
  jobs resolve their embedding provider through the same `profiles.get('default')`
  path as persisted jobs, instead of a separate bare provider pair — a
  multi-profile server's `'default'`-named profile (if any) now applies to
  ephemeral jobs too. The pin/allow-list *enforcement* gate itself remains
  persisted-job-only (ephemeral jobs have no registry row to pin a profile
  against).

### Admin-gated enabled sets (Phase 129)

A superadmin/operator can restrict which defined embedding profiles and
narrator/guide model configs are actually selectable, server-wide and
(for embedding profiles) per-org.

- **CLI:** `gitsema admin models list --kind <embedding|narrator|guide>
  [--org <name>]` shows the effective allowed set; `gitsema admin models
  allow|deny <identifier> --kind <kind> [--org <name>]` and `gitsema admin
  models reset --kind <kind> [--org <name>]` manage it.
- **Policy semantics:** no policy set = default-allow-all (Phase 128
  behavior unchanged). The first `allow` call seeds an opt-in set
  containing only that identifier; the first `deny` call seeds an opt-out
  set containing every other currently-defined item. Denying every defined
  item reaches "lock to none" — a valid, tested state.
- **Org narrowing.** An org's effective allowed set is always intersected
  with the server-wide set — an org can narrow but never widen past what
  the server allows. Embedding profiles support org narrowing end-to-end
  (`POST /api/v1/remote/index` resolves the requesting repo's org via
  `getRepoOrgId` and 403s a disabled profile pick). Narrator/guide
  enforcement is server-wide only — `gitsema models activate` rejects
  activating a server-disabled narrator/guide config, but there is no
  per-org narrowing for them yet (no HTTP entry point carries org context
  for narrator/guide activation).
- **Pinned repos are exempt.** A repo already pinned to an embedding
  profile (Phase 128) keeps reindexing successfully even after that
  profile is later disabled — disabling only blocks *new* profile
  selections, never an existing pin.
- Policy is stored in the existing `settings` table as JSON blobs
  (`model_allowlist:server:<kind>` / `model_allowlist:org:<orgId>:<kind>`)
  — no schema change.

### BYOK (bring-your-own-key) for narrator/guide (Phase 130)

`narrate`, `explain`, and `guide` accept request-scoped LLM credentials
that bypass the DB-backed narrator/guide config system entirely — no
`embed_config`/`settings` write, and no allow-list check (Phase 129),
so BYOK still works even when every defined narrator/guide config is
denied server-wide ("lock to none").

- **CLI:** `--byok-http-url <url>` (required to activate BYOK)
  `--byok-api-key <key>` `--byok-model <name>` `--byok-max-tokens <n>`
  `--byok-temperature <n>` on `gitsema narrate`, `gitsema explain`, and
  `gitsema guide`.
- **HTTP:** `POST /api/v1/narrate` and `POST /api/v1/explain` accept a
  `byok: {httpUrl, apiKey?, model?, maxTokens?, temperature?}` body field;
  `POST /api/v1/guide/chat` accepts the same shape with its existing
  snake_case convention (`byok: {http_url, api_key?, model?, max_tokens?,
  temperature?}`).
- **MCP:** `narrate_repo` and `explain_issue_or_error` accept flattened
  `byok_http_url`/`byok_api_key`/`byok_model`/`byok_max_tokens`/
  `byok_temperature` input fields.
- Resolution order in `resolveNarratorProvider`/`resolveGuideConfig`: BYOK
  (if supplied) short-circuits before any other lookup — explicit model
  id, model name, active DB selection, disabled. BYOK always resolves to
  an HTTP/`chattydeer`-backed provider.

### Persistent server-side repo storage

`POST /api/v1/remote/index` **persists** the clone + index by default (`persist: true`),
storing them under `GITSEMA_DATA_DIR` (default `~/.gitsema/data`) so subsequent requests
for the same `repoUrl` reuse the existing clone (`git fetch` instead of a fresh clone)
and run an incremental re-index against the existing `index.db`, instead of starting
from scratch:

```
$GITSEMA_DATA_DIR/
  registry.db              # persisted-repo registry (repos + repo_tokens)
  repos/
    <repoId>/
      repo/                 # persistent git clone (working copy)
      index.db              # this repo's gitsema index
```

- `repoId` is a 16-character hex digest derived from the normalized `repoUrl`
  (credentials, trailing `.git`, and trailing slashes stripped, host lowercased) —
  repeated registrations of the same URL resolve to the same `repoId` and on-disk
  directory.
- The `202 Accepted` response includes `repoId`; pass it as `repoId` on
  `/api/v1/search`, `/api/v1/search/first-seen`, `/api/v1/evolution/*`,
  `/api/v1/analysis/*`, `/api/v1/watch/*`, `/api/v1/projections/*`, `/api/v1/narrate`,
  `/api/v1/explain`, and `/api/v1/guide` (body field for `POST`, query string for `GET`)
  to run the request against that repo's persisted index instead of the default
  cwd `.gitsema/index.db`.
- Per-repo scoped tokens (`gitsema repos token add <repo-id>`) restrict requests to
  their own `repoId`: a mismatched `repoId` returns `403`, and scoped tokens cannot
  register new repos.
- Pass `repoId` explicitly to target an already-registered repo without
  re-supplying `repoUrl`'s exact form; `404` if unknown, `409` if it doesn't match
  the normalized `repoUrl`.
- Set `persist: false` to fall back to the legacy ephemeral behavior (clone to a
  temp dir, governed by `GITSEMA_CLONE_KEEP`/`GITSEMA_CLONE_DIR`, optionally with
  `dbLabel` for an ad-hoc named DB). Failed re-index attempts on a persisted repo
  never deregister it or delete its clone — search keeps serving the last-good index.
- **SSH agent forwarding**: when a persistent clone/fetch needs SSH and no explicit
  `credentials` are supplied in the request, the server forwards its own
  `SSH_AUTH_SOCK` (if set) to `git`, so operators can re-index private repos on a
  recurring basis without sending per-request keys.
- Manage persisted repos with `gitsema repos list-persisted` and
  `gitsema repos remove <repoId> [--purge]`.

### Operational features (P2)

- **Prometheus metrics** (`GET /metrics`): exposes HTTP latency histograms, index size gauges, embedding error counters, query cache hit/miss counters, and Node.js default metrics. Protected by auth by default; set `GITSEMA_METRICS_PUBLIC=1` to allow unauthenticated scraping.
- **Rate limiting**: per-token when auth is enabled, per-IP otherwise. Returns `429 Too Many Requests` with `Retry-After` header. Configure via `GITSEMA_RATE_LIMIT_RPM` (default 300) and `GITSEMA_RATE_LIMIT_BURST`.
- **OpenAPI spec** (`GET /openapi.json`): machine-readable OpenAPI 3.1 spec generated from Zod route schemas.
- **Swagger UI** (`GET /docs`): interactive API explorer loaded from CDN.
- **Deployment guide**: [`docs/deploy.md`](docs/deploy.md) covers systemd, Docker/Ollama sidecar, secrets, backups, model rotation, recommended settings, and team operations (token rotation, audit logging, backup/restore drills).
- **Playbooks**: [`docs/playbooks.md`](docs/playbooks.md) provides role-based quickstart recipes for solo developers, PR reviewers, security engineers, and release managers.

---

## MCP Tools

Start with `gitsema tools mcp`. All tools share the same core logic as the CLI.

| Tool name | Description |
|---|---|
| `semantic_search` | Vector similarity search — full CLI `search` flag parity since Phase 138 (levels incl. `module`, per-level `resultsByLevel`-equivalent text sections, negative-example scoring, boolean composition, `explain`/`explain_llm`, `expand_query`, `annotate_clusters`, `vss`, `repos`, per-request model overrides, `early_cut`, `no_cache`) |
| `code_search` | Symbol / chunk-level code search |
| `search_history` | Vector search enriched with Git history metadata |
| `first_seen` | Find when a concept first appeared (chronological sort) — gained `vss`, `repos`, and model overrides in Phase 138 |
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
| `experts` | Top contributors by semantic area (which concepts/clusters they work on) |
| `doc_gap` | Find code blobs with insufficient documentation coverage |
| `contributor_profile` | Top blobs an author specializes in (semantic centroid of their commits) |
| `ownership` | Ownership heatmap: ranks authors by share of touched blobs for a concept |
| `eval` | Retrieval evaluation harness — precision@k, recall@k, MRR for a JSONL test set |
| `triage` | Incident triage bundle: first-seen, change points, evolution, bisect, experts |
| `policy_check` | CI policy gate — debt score, security similarity, and concept drift thresholds |
| `workflow_run` | Run a named workflow template (`pr-review` \| `incident` \| `release-audit`) |
| `call_graph` | Structural call-graph traversal — callers/callees of a symbol (Phase 108) |
| `graph_neighbors` | Typed neighborhood of a graph node — any edge kinds, direction, depth (Phase 108) |

---

## Protocol Servers (`tools` subcommand)

| Subcommand | Description |
|---|---|
| `gitsema tools mcp [--remote <url>] [--remote-key <token>] [--remote-timeout <ms>] [--websocket <bind-address>] [--http <bind-address>] [--key <token>]` | MCP stdio server (preferred entry point for AI clients) |
| `gitsema tools lsp [--tcp <port>] [--websocket <bind-address>] [--key <token>] [--remote <url>] [--remote-key <token>] [--remote-timeout <ms>] [--diagnostics]` | LSP semantic hover server (JSON-RPC over stdio, TCP, or WebSocket) — `--tcp` is deprecated, use `--websocket` |
| `gitsema tools serve [--port n] [--key token] [--ui]` | HTTP API server |

### Remote delegation (Phase 113)

`tools mcp --remote <url>` and `tools lsp --remote <url>` delegate every data-access
call to a running `gitsema tools serve` instance instead of executing locally — both
protocols share one mechanism: `src/core/remote/protocolClient.ts`'s `callRemote()`
posts `{ args }` to `POST /api/v1/protocol/<operation>` (`mcp.<toolName>` or
`lsp.<op>`) and unwraps `{ result }` / `{ error }`. `--remote-key`/`GITSEMA_REMOTE_KEY`
sets a Bearer token; `--remote-timeout`/default 10000ms aborts slow calls. On
startup, both commands call `checkRemoteHealth()` (`GET /api/v1/status`) and exit
non-zero immediately if the remote is unreachable, rather than failing on the first
tool call. No MCP tool handler or LSP method handler was duplicated to add this —
`registerTool()` (the single chokepoint every MCP tool passes through) and
`handleRequest()` (LSP's existing JSON-RPC dispatcher) each gained one
remote-delegation branch; the server-side route reuses the same tool-registration
functions and LSP dispatcher via a small "capture" indirection, so business logic
stays in one place.

> Legacy top-level aliases `gitsema mcp`, `gitsema lsp`, and `gitsema serve` still work but emit a deprecation warning.

### Structural navigation (Phase 114)

`textDocument/definition` and `textDocument/references` are structural-first: when
the Phase 106/107 knowledge graph is built (`gitsema graph build`) and the queried
identifier resolves to an exact graph node, the LSP server returns that exact
location (or its structural referrers) with no semantic ranking involved. When the
graph isn't built, the identifier doesn't resolve, or it resolves with no incoming
edges, the server falls back to the prior symbol/FTS/semantic-search behavior —
every fallback location is tagged `tags: ['fallback']` so clients can distinguish
exact structural results from approximate ones. The two never mix into one ranked
list (per the LSP & MCP fleshout spec §5.3).

Three new JSON-RPC methods add call-hierarchy support, backed by the same graph:
`textDocument/prepareCallHierarchy` resolves a symbol to a `CallHierarchyItem`
(carrying the resolved graph node key in `data`), and `callHierarchy/incomingCalls`
/ `callHierarchy/outgoingCalls` return its direct (depth-1) callers/callees via the
`calls` edge type. The server advertises `callHierarchyProvider: true` in
`initialize`. All of this reuses `src/core/graph/traversal.ts` and `resolveNode.ts`
directly (`src/core/lsp/structuralNav.ts`) — no new graph-query SQL was added; the
only new SQL is a `symbols` table lookup (by `qualified_name` + `blob_hash`) to
recover line ranges for graph nodes, since the graph itself stores no line data.

### Diagnostics, code lens, and rich hover (Phase 115)

`textDocument/hover` now enriches its existing semantic-match section with up to
three optional sections — **Temporal** (last author + change frequency, from
`blob_commits`/`commits`), **Risk & quality** (debt score, hotspot risk, security
pattern match count), and **Structure** (caller/callee counts, when the Phase
106/107 knowledge graph is built) — each independently omitted, never erroring
the whole hover, when its data source is unavailable. Debt/hotspot/security
signals are computed once on a background timer (default every 5 minutes, never
synchronously inside a request) by `src/core/lsp/analysisCache.ts`, which reuses
`scoreDebt()`/`computeHotspots()`/`scanForVulnerabilities()` directly — no
duplicated scoring logic.

A new `textDocument/codeLens` method annotates each symbol in a file with
`Called N× · debt X.XX`-style text, reading from the same cache and the
Phase 107 graph's caller counts. `initialize` now advertises
`codeLensProvider: true`, and `lsp.codeLens` is remote-delegatable like any other
LSP data method.

Diagnostics (`textDocument/publishDiagnostics`) are opt-in via
`gitsema tools lsp --diagnostics` (off by default — the false-positive rate of
the v1 thresholds, debt score ≥ 0.7 or hotspot risk ≥ 0.6, is unproven). When
enabled, the server pushes a notification per flagged file on each background
refresh cycle, over stdout (stdio transport) or to every connected socket (TCP
transport). Diagnostics are not supported in `--remote` mode, since remote
delegation (Phase 113) is purely request/response and has no mechanism for the
remote server to push notifications back to a local client — `gitsema tools lsp
--remote <url> --diagnostics` prints a warning and runs without diagnostics.

`gitsema tools lsp --tcp <port>` is **deprecated** (Phase 120): it has no
`--key`/authentication mechanism at all (unlike `--websocket`, which supports
`--key`/`GITSEMA_WEBSOCKET_KEY`), and raw TCP has no header to carry a bearer
token in — any client that can reach the port gets full LSP access. A
deprecation warning is printed on every invocation recommending `--websocket
--key` instead, which is a strict superset of `--tcp`'s use case (same
JSON-RPC dispatcher, with working auth). `--tcp` connections remain bounded
by the same `DEFAULT_MAX_CONNECTIONS` cap as the other transports
(review10 §3.5) and the flag still works — it is not scheduled for removal.

### WebSocket transport (Phase 116)

Both `gitsema tools mcp --websocket <bind-address>` and `gitsema tools lsp --websocket
<bind-address>` (e.g. `--websocket 0.0.0.0:4242`) listen on fixed `/mcp`/`/lsp` paths
respectively, as an alternative to stdio/TCP for clients that need a network-reachable
transport (no `--path` flag in v1). `--key <token>` requires a matching
`Authorization: Bearer <token>` header on the WS upgrade request (mirrors
`gitsema tools serve --key`'s convention); unset means no auth. `--key` falls back to
the shared `GITSEMA_WEBSOCKET_KEY` env var, and binding to a non-loopback host with no
key prints a startup warning (review10 §3.3). Connections are bounded by a fixed
`maxPayload` (`DEFAULT_MAX_WS_PAYLOAD`, 10MB) and a connection-count cap
(`DEFAULT_MAX_CONNECTIONS`, 100; `src/core/util/websocket.ts`) so an unbounded client
can't exhaust memory or fan out unbounded sessions. gitsema does not
terminate TLS — put a reverse proxy in front for `wss://`.

The MCP SDK ships no server-side WebSocket transport, so `src/mcp/webSocketTransport.ts`
is a small hand-rolled `Transport` implementation over a `ws` socket, negotiating the
`mcp` WS subprotocol for interop with the SDK's own client-side `WebSocketClientTransport`
(which only works unauthenticated, since it can't set custom headers). Because the SDK's
`Protocol.connect()` can only be called once per `McpServer` instance, each WebSocket
connection gets its own freshly-built server (`buildMcpServer()`) rather than sharing one
instance the way stdio does. On the LSP side, WebSocket reuses the same stateless
`handleRequest()` dispatcher as TCP, just framed as raw JSON per WS text frame instead of
`Content-Length`-prefixed chunks — and unlike `--remote` delegation, WebSocket supports
server push, so `--diagnostics` works normally over `--websocket`.

**MCP `--websocket` is a known design flaw, kept only for forward compatibility.**
Raw WebSocket was never one of MCP's standard transports (stdio / HTTP+SSE / Streamable
HTTP); essentially no real-world MCP client or harness (Claude Desktop, Claude Code,
etc.) supports connecting to an MCP server over plain WebSocket, so `gitsema tools mcp
--websocket` prints a warning on startup that it is likely unusable with most clients.
LSP `--websocket` has no such caveat — LSP has no standardized transport set, and
WebSocket is a normal way IDEs reach LSP servers. Phase 117 (below) adds the proper
fix for the MCP side.

### MCP Streamable HTTP transport (Phase 117)

`gitsema tools mcp --http <bind-address>` (e.g. `--http 0.0.0.0:4242`) listens on a fixed
`/mcp` path using the MCP SDK's own `StreamableHTTPServerTransport`
(`@modelcontextprotocol/sdk/server/streamableHttp.js`) — the SDK's actual recommended
network transport, unlike the non-standard `--websocket`. `--key <token>` requires a
matching `Authorization: Bearer <token>` header, same convention as `--websocket`/`gitsema
tools serve --key`; it falls back to `GITSEMA_MCP_HTTP_KEY`, and binding to a
non-loopback host with no key warns at startup (review10 §3.3). Request bodies are
capped via `GITSEMA_MAX_BODY_SIZE` (default `1mb`, checked against the declared
`Content-Length` since the SDK consumes the body stream itself) and concurrent
sessions are capped at `DEFAULT_MAX_CONNECTIONS` (100), rejecting new sessions with
`503` once full. gitsema does not terminate TLS — put a reverse proxy in front for
`https://`.

Sessions are stateful: a `POST /mcp` with no `Mcp-Session-Id` header and an `initialize`
body starts a new session (fresh `McpServer` via `buildMcpServer()`, fresh
`StreamableHTTPServerTransport` with `sessionIdGenerator: () => randomUUID()`), and the
generated session ID is returned in response headers. Every subsequent request
(`POST`/`GET`/`DELETE`) carrying that `Mcp-Session-Id` header is routed to the *same*
transport instance — unlike the WebSocket transport, where `Protocol.connect()` is called
once per *connection*, here it's called once per *session*, and one session can span many
HTTP requests. Unknown session IDs get `404`; non-`initialize` requests with no session ID
get `400` — matching the SDK's documented stateful-mode contract. No `EventStore`
(resumability) in v1, same "keep it minimal" posture as Phase 116.

---

## Maintenance & DB

| Feature | Command |
|---|---|
| Index statistics | `gitsema status [file]` |
| DB integrity check | `gitsema index doctor` |
| Auto-repair fixable issues (missing FTS content, orphan embeddings) | `gitsema index doctor --fix` |
| SQLite VACUUM + ANALYZE | `gitsema index vacuum` |
| Garbage-collect orphan embeddings | `gitsema index gc` |
| Rebuild FTS5 index | `gitsema index rebuild-fts` |
| Backfill FTS5 content for pre-Phase-11 blobs *(deprecated, Phase 128 — use `index rebuild-fts`)* | `gitsema index backfill-fts` |
| Build / rebuild HNSW VSS index | `gitsema index build-vss` |
| Remove embeddings for a specific model | `gitsema index clear-model <model>` |
| Recalculate module-level embeddings | `gitsema index update-modules` |
| Export index bundle (tar.gz) | `gitsema index export` |
| Import index bundle | `gitsema index import` |
| Saved semantic watches | `gitsema watch add/list/remove/run` |

---

## Model Management

Model profiles allow different models to use different providers, base URLs, and API keys. Profiles are stored in `.gitsema/config.json` (local) or `~/.config/gitsema/config.json` (global, `--global`).

Per-model settings override the global `GITSEMA_PROVIDER` / `GITSEMA_HTTP_URL` / `GITSEMA_API_KEY` environment variables, so Ollama and OpenAI models can coexist in the same index.

| Feature | Command |
|---|---|
| List configured profiles + indexed models | `gitsema models list [--json]` |
| Show model info (config + index stats) | `gitsema models info <name>` |
| Configure a model's provider settings | `gitsema models add <name> [--provider] [--url] [--key]` |
| Set as default / text / code model | `gitsema models add <name> --set-default` (or `--set-text`, `--set-code`) |
| Remove a model profile | `gitsema models remove <name>` |
| Remove profile + purge index data | `gitsema models remove <name> --purge-index` |

**Example:**
```bash
# Add OpenAI model with dedicated API key
gitsema models add text-embedding-3-small \
  --provider http --url https://api.openai.com --key sk-... --set-text

# Use Ollama for code, OpenAI for prose
gitsema models add nomic-embed-text --provider ollama --set-code

# Then index — the right provider is chosen per model automatically
gitsema index start
```

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

### Storage backends & scoping (experimental — Phases 101–103)

A pluggable storage seam splits persisted data into three async stores —
`MetadataStore` (relational facts), `VectorStore` (embeddings + similarity), and
an optional `FtsStore` (keyword/BM25) — so each can later be backed by a
different technology. Phase 101 shipped the seam plus a SQLite adapter that
preserves existing behavior. Phase 102 added a Postgres + pgvector adapter, and
Phase 103 adds a Qdrant adapter plus indexer write-path support, a
`storage migrate` command, and cross-store `doctor`/`status` reporting — for
all three backends.

| Key | Values | Notes |
|---|---|---|
| `storage.backend` | `sqlite` (default) · `postgres` · `qdrant` | all three implemented |
| `storage.scope` | `project` (default) · `user` · `named` | which index a command resolves to |
| `storage.name` | string | required when `scope=named` |
| `storage.metadata.url` | path / URL | metadata store location: a file path for SQLite, or a `postgres://...` connection string for `storage.backend=postgres`/`qdrant` (qdrant's relational companion) |
| `storage.vectors.url` | Qdrant `http(s)://` URL | required for `storage.backend=qdrant` |
| `storage.vectors.apiKey` | string | optional Qdrant API key |
| `storage.fts.backend` | `tsvector` (default) · `pg_search` · `none` | postgres/qdrant only — `tsvector` (`ts_rank_cd`), opt-in ParadeDB `pg_search` BM25, or `none` to disable hybrid search |

**Postgres + pgvector backend (Phase 102):** set `storage.backend=postgres` and
`storage.metadata.url=postgres://user:pass@host:5432/dbname` (a pgvector-enabled
Postgres, e.g. `pgvector/pgvector:pg16` — see `docker-compose.postgres.yml`).
Schema migrations run automatically and idempotently on first connection.
`gitsema index` and all read-path commands (search, history, evolution, etc.)
work against this backend. Vector search uses a wide ANN candidate pool (exact
`<=>` cosine distance, since embedding columns are unconstrained to support
multiple models/dimensions) re-ranked with the same three-signal scoring as
SQLite; `--vss`, `allowedHashes`, `earlyCut`, and result caching are not yet
supported on this backend.

**Qdrant backend (Phase 103):** set `storage.backend=qdrant`,
`storage.vectors.url=http://host:6333` (a Qdrant instance — see
`docker-compose.qdrant.yml`), and `storage.metadata.url=postgres://...` (a
Postgres companion for paths/commits/branches/FTS, reusing the Phase 102
adapter). Embeddings are stored in one Qdrant collection per
`(kind, model, dimensions)` tuple, created lazily on first `index` run.
`gitsema index` writes to both stores; search fetches a wide ANN pool from
Qdrant and re-ranks in JS, same as the Postgres adapter. **Caveat:**
cross-store writes (Postgres metadata + Qdrant vectors) are not atomic — a
partial write self-heals on the next incremental `index` run via the existing
dedup check. Module (directory centroid) embeddings remain SQLite-only for
postgres/qdrant backends.

**`gitsema storage` / `gitsema storage info`:** prints the resolved
`storage.*` configuration (backend, scope, location, FTS status) without
opening any connections — the quick way to confirm which backend/scope a
command will operate against before running `index`, `storage migrate`,
`doctor`, or `status`. Bare `gitsema storage` is an alias for `storage info`.

**`gitsema storage migrate --to <backend> [options]`:** copies the active
index into another storage backend (sqlite/postgres/qdrant), using
content-addressed/idempotent writes so a migration is safe to re-run/resume.
Only `sqlite` sources are supported today (the common "move my local index to
a shared backend" path). See `gitsema storage migrate --help` for the
`--to-path` / `--to-metadata-url` / `--to-vectors-url` / `--to-vectors-api-key`
/ `--to-fts-backend` flags.

**`gitsema doctor` / `gitsema status`:** for postgres/qdrant profiles, both
commands report the active backend/scope/location plus row counts (blobs,
paths, commits, indexed commits, branches, file embeddings) and flag FTS/vector
count mismatches. The deep sqlite-only checks (`PRAGMA integrity_check`, schema
version, FTS5 backfill, `--extended` model/freshness/latency checks) remain
sqlite-specific.

See [`docs/storage-backends-plan.md`](storage-backends-plan.md) for the full design.

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
9. ~~Add policy-style CI gates for drift/debt/security thresholds.~~ ✅ Phase 66 (`gitsema policy-check`)
10. ~~Add AI-oriented provenance explain mode for prompt grounding.~~ ✅ Phase 64 (`--explain-llm`)
11. ~~Add saved workflow templates (`pr-review`, `incident`, `release-audit`).~~ ✅ Phase 68 (`gitsema workflow run`)
12. ~~Add retrieval quality evaluation harness for AI workflows.~~ ✅ Phase 64 (`gitsema eval`)

All 12 original productization proposals from review4 are now shipped. See [`docs/review5.md`](docs/review5.md) for the next set of priorities.

---

## Planned / In Progress

This section is intentionally brief. The canonical roadmap is in [`docs/PLAN.md`](docs/PLAN.md).
