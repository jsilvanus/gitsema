# Tool Parity & Flag Coherence

This document tracks the availability of gitsema tools and commands across all interfaces, and the implementation of common flags across the CLI. It serves as the single source of truth for interface parity and helps identify gaps, inconsistencies, and opportunities for unification.

**Last updated:** 2026-06-16  
**Maintainer note:** Any tool change, interface change, or flag addition must be reflected in the tables below and in the canonical sections of `CLAUDE.md` / `docs/features.md` / `README.md`.

---

## 1. Tool Parity Matrix

This table shows which tools/commands are available in which interface. A checkmark (✓) means the tool is fully available; a dash (—) means it's not available in that interface.

### Legend
- **CLI**: Command-line interface (85 commands)
- **REPL**: Lightweight interactive search REPL (search only)
- **Guide**: Agentic tool-calling loop in `gitsema guide` (47 tools, max 5 roundtrips)
- **MCP**: Model Context Protocol tools (45 tools for AI clients)
- **HTTP**: REST API server via `gitsema tools serve` (~30 endpoints)
- **CLI Interactive** (planned): Full CLI in interactive mode
- **Web UI** (planned): Browser-based interface
- **MCP HTTP** (planned): MCP over HTTP instead of stdio

### Tool Matrix

| Tool/Command | CLI | REPL | Guide | MCP | HTTP | Interactive | Web UI | MCP HTTP |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Search & Discovery** |
| `search` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `first-seen` | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `code-search` | ✓ | — | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| `dead-concepts` | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Analysis & Trends** |
| `evolution` / `concept-evolution` | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `file-evolution` / `file-diff` | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `diff` / `semantic-diff` | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `change-points` | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `file-change-points` | ✓ | — | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| `cluster-change-points` | ✓ | — | — | — | — | ✓ | ✓ | — |
| **Blame & Attribution** |
| `semantic-blame` | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `author` | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `experts` | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `contributor-profile` | ✓ | — | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| **Clustering & Organization** |
| `clusters` | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `cluster-diff` | ✓ | — | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| `cluster-timeline` | ✓ | — | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| **Branch & Merge** |
| `branch-summary` | ✓ | — | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| `merge-audit` | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `merge-preview` | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Quality & Metrics** |
| `health` | ✓ | — | — | — | ✓ | ✓ | ✓ | — |
| `debt` | ✓ | — | — | — | ✓ | ✓ | ✓ | — |
| `security-scan` | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `doc-gap` | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `eval` | ✓ | — | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| **Impact & Dependencies** |
| `impact` | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `co-change` | ✓ | — | — | — | — | ✓ | ✓ | — |
| `deps` | ✓ | — | — | — | — | ✓ | ✓ | — |
| `cycles` | ✓ | — | — | — | — | ✓ | ✓ | — |
| **Graph & Structure** |
| `graph build` | ✓ | — | — | — | — | ✓ | — | — |
| `graph callers` | ✓ | — | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| `graph callees` | ✓ | — | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| `graph neighbors` | ✓ | — | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| `graph path` | ✓ | — | — | — | — | ✓ | ✓ | — |
| `graph relate` | ✓ | — | — | — | — | ✓ | ✓ | — |
| `graph similar` | ✓ | — | — | — | — | ✓ | ✓ | — |
| `graph unused` | ✓ | — | — | — | — | ✓ | ✓ | — |
| `blast-radius` | ✓ | — | — | — | — | ✓ | ✓ | — |
| `hotspots` | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Workflow & CI** |
| `triage` | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `policy-check` | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `regression-gate` | ✓ | — | — | — | — | ✓ | ✓ | — |
| `code-review` | ✓ | — | — | — | — | ✓ | ✓ | — |
| `pr-report` | ✓ | — | — | — | — | ✓ | ✓ | — |
| `cherry-pick-suggest` | ✓ | — | — | — | — | ✓ | ✓ | — |
| `workflow` | ✓ | — | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| **Narrative & Analysis** |
| `narrate` | ✓ | — | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| `explain` | ✓ | — | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| `guide` | ✓ | — | — | — | ✓ | ✓ | ✓ | — |
| **Indexing & Maintenance** |
| `index` | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `index start` | ✓ | — | — | — | ✓ | ✓ | ✓ | — |
| `index doctor` | ✓ | — | — | — | — | ✓ | — | — |
| `index vacuum` | ✓ | — | — | — | — | ✓ | — | — |
| `index rebuild-fts` | ✓ | — | — | — | — | ✓ | — | — |
| `index backfill-fts` | ✓ | — | — | — | — | ✓ | — | — |
| `index update-modules` | ✓ | — | — | — | — | ✓ | — | — |
| `index gc` | ✓ | — | — | — | — | ✓ | — | — |
| `index clear-model` | ✓ | — | — | — | — | ✓ | — | — |
| `index build-vss` | ✓ | — | — | — | — | ✓ | — | — |
| **Configuration & Setup** |
| `status` | ✓ | — | — | — | ✓ | ✓ | ✓ | — |
| `config` | ✓ | — | — | — | — | ✓ | ✓ | — |
| `models` | ✓ | — | — | — | — | ✓ | — | — |
| `repos` | ✓ | — | — | — | — | ✓ | ✓ | — |
| `quickstart` / `setup` | ✓ | — | — | — | — | ✓ | ✓ | — |
| **Visualization** |
| `map` | ✓ | — | — | — | — | ✓ | ✓ | — |
| `heatmap` | ✓ | — | — | — | — | ✓ | ✓ | — |
| `project` | ✓ | — | — | — | — | ✓ | ✓ | — |
| **Protocols & Servers** |
| `tools serve` | ✓ | — | — | — | — | ✓ | — | — |
| `tools mcp` | ✓ | — | — | — | — | ✓ | — | — |
| `tools lsp` | ✓ | — | — | — | — | ✓ | — | — |
| **Multi-Repo** |
| `multi-repo-search` | — | — | ✓ | ✓ | ✓ | — | — | ✓ |
| `cross-repo-similarity` | ✓ | — | — | — | — | ✓ | ✓ | — |

### Parity Observations

**Complete parity (available in 5+ interfaces):**
- `search`, `first-seen`, `evolution`, `semantic-blame`, `author`, `clusters`, `merge-audit`, `merge-preview`, `security-scan`, `triage`, `policy-check`, `index`

**CLI-only gaps (not in Guide/MCP):**
- `index doctor`, `graph path`, `graph relate`, `graph similar`, `graph unused`, `blast-radius`, `regression-gate`, `code-review`, `pr-report`, `cherry-pick-suggest`, `co-change`, `deps`, `cycles`, and all maintenance subcommands

**HTTP gaps:**
- Most graph commands (`callers`, `callees`, `neighbors`, `path`, `relate`, `similar`, `unused`)
- `code-search`, `file-change-points`, `cluster-diff`, `cluster-timeline`, `branch-summary`, `contributor-profile`, `eval`, `regression-gate`, `code-review`, `pr-report`, `cherry-pick-suggest`

---

## 2. Flag Implementation & Coherence

This section documents all flags used across CLI commands, their consistency, and coverage.

### 2.1 General/Shared Flags (Across Multiple Commands)

| Flag | Short | Type | Default | Used By | Notes |
|---|:---:|---|:---:|---|---|
| `--top` | `-k` | int | varies | `search`, `first-seen`, `code-search`, `triage`, `eval`, `pr-report`, `experts`, `etc.` | Result limit; should be standardized to default=10 across all |
| `--model` | — | string | env | `search`, `first-seen`, `code-search`, `index start` | Override embedding model for current command |
| `--text-model` | — | string | env | `search`, `first-seen`, `code-search`, `index start` | Override text/prose embedding model |
| `--code-model` | — | string | env | `search`, `first-seen`, `code-search`, `index start` | Override source-code embedding model |
| `--remote` | — | string | env | `search`, `first-seen`, `index start` | Proxy to remote gitsema server |
| `--branch` | — | string | — | `search`, `first-seen`, `code-search`, `evolution`, `index start` | Restrict to commits reachable from branch |
| `--hybrid` | — | bool | false | `search`, `first-seen`, `code-search` | Blend vector similarity with BM25 keyword matching |
| `--bm25-weight` | — | float | 0.3 | `search`, `first-seen`, `code-search` | Weight for BM25 signal in hybrid search |
| `--before` | — | date | — | `search`, `evolution`, `pr-report`, `ownership` | Temporal filter: blobs first seen before this date |
| `--after` | — | date | — | `search`, `evolution`, `pr-report`, `ownership` | Temporal filter: blobs first seen after this date |
| `--since` | — | date | — | `search`, `evolution`, `file-evolution`, `index start` | Alias for `--after` (search) or resume point (index) |
| `--until` | — | date | — | `search`, `evolution`, `pr-report` | Alias for `--before` |
| `--dump` | — | [string] | — | `search`, `first-seen`, `triage`, `policy-check`, `code-review`, etc. | Legacy JSON output flag; prefer `--out` |
| `--out` | — | string[] | — | `search`, `first-seen`, `triage`, `policy-check`, `code-review`, etc. | Modern unified output spec: `text\|json[:file]\|html[:file]\|markdown[:file]` |
| `--html` | — | [string] | — | `search`, `first-seen`, `eval` | Legacy interactive HTML output; prefer `--out html` |
| `--narrate` | — | bool | false | `triage`, `ownership`, `narrate`, `guide` | Generate LLM narrative summary (requires `GITSEMA_LLM_URL`) |
| `--vss` | — | bool | false | `search`, `first-seen` | Use usearch HNSW ANN index for approximate search |
| `--format` | — | enum | text | `regression-gate`, `cross-repo-similarity`, `code-review` | Output format: `text` or `json` (legacy; prefer `--out`) |
| `--dry-run` | — | bool | false | `index gc`, `storage migrate` | Preview changes without applying them |
| `--verbose` | — | bool | false | top-level flag, `index update-modules`, `index gc` | Enable verbose debug logging |
| `--yes` | `-y` | bool | false | `index rebuild-fts`, `index clear-model` | Skip confirmation prompts |
| `--no-headings` | — | bool | false | `search`, `first-seen` | Don't print column header row |
| `--explain` | — | bool | false | `search`, `repl` | Show score component breakdown for each result |
| `--vss` | — | bool | false | `search`, `first-seen` | Use vector search index for approximate search |
| `--level` | — | enum | file | `search`, `code-search`, `repl` | Search/index granularity: `file`, `chunk`, `symbol`, or `module` |
| `--chunker` | — | enum | file | `index start` | Chunking strategy: `file`, `function`, or `fixed` |
| `--lens` | — | enum | hybrid | `blast-radius`, `relate`, `similar`, `hotspots` | Structural/semantic lens toggle: `structural`, `semantic`, `hybrid` |
| `--depth` | — | int | varies | `deps`, `graph callers`, `graph callees`, `graph neighbors`, `graph path`, `blast-radius` | Traversal depth for graph commands |
| `--repos` | — | string | — | `search`, `first-seen` | Comma-separated repo IDs for multi-repo mode |
| `--threshold` | — | float | varies | `code-review`, `cross-repo-similarity`, `policy-check` | Similarity/distance threshold for matching |
| `--base` | — | ref | varies | `regression-gate`, `code-review`, `ci-diff` | Base git ref to compare from |
| `--head` | — | ref | varies | `regression-gate`, `code-review`, `ci-diff` | Head git ref to compare to |

### 2.2 Command-Specific Flags

This table shows less common flags used by specific commands or command groups.

| Flag | Used By | Type | Default | Purpose |
|---|---|---|:---:|---|
| `--recent` | `search`, `semantic-diff` | bool | false | Blend cosine similarity with recency score |
| `--alpha` | `search`, `semantic-diff` | float | 0.8 | Weight for cosine similarity in blended score |
| `--weight-vector` | `search`, `semantic-diff` | float | 0.7 | Vector similarity weight in three-signal ranking |
| `--weight-recency` | `search`, `semantic-diff` | float | 0.2 | Recency weight in three-signal ranking |
| `--weight-path` | `search` | float | 0.1 | Path-relevance weight in three-signal ranking |
| `--group` | `search`, `semantic-diff` | enum | — | Collapse results by: `file`, `module`, or `commit` |
| `--chunks` | `search`, `code-search`, `first-seen` | bool | false | Include chunk-level embeddings in results |
| `--include-commits` | `search`, `first-seen` | bool | false | Also search commit message embeddings |
| `--annotate-clusters` | `search` | bool | false | Annotate each result with cluster label |
| `--not-like` | `search` | string | — | Negative example query (subtract from score) |
| `--lambda` | `search` | float | 0.5 | Weight for negative example subtraction |
| `--early-cut` | `search` | int | 0 | Limit candidate pool to n random samples |
| `--explain-llm` | `search` | bool | false | Output LLM-ready provenance citation block |
| `--or` | `search` | string | — | Combine results with another query via OR |
| `--and` | `search` | string | — | Combine results with another query via AND |
| `--expand-query` | `search` | bool | false | Expand query with top BM25 keywords before embedding |
| `--concurrency` | `index start` | int | 4 | Parallel embedding calls |
| `--ext` | `index start` | string | — | Only index files with these comma-separated extensions |
| `--max-size` | `index start` | size | 200kb | Skip blobs larger than this |
| `--exclude` | `index start` | string | — | Skip paths containing these comma-separated patterns |
| `--include-glob` | `index start` | string | — | Only index files matching these glob patterns |
| `--window-size` | `index start` | int | 1500 | Target chunk size (chars) for fixed chunker |
| `--overlap` | `index start` | int | 200 | Overlap between fixed chunks (chars) |
| `--embed-batch-size` | `index start` | int | 1 | Texts per embedBatch() call |
| `--file` | `index start`, `pr-report` | string[] | — | Index specific file(s) or focus on file in pr-report |
| `--quantize` | `index start` | bool | false | Store embeddings as int8-quantized vectors |
| `--build-vss` | `index start` | bool | false | Build usearch HNSW ANN index after indexing |
| `--auto-build-vss` | `index start` | [int] | — | Build VSS index when blob count exceeds threshold |
| `--allow-mixed` | `index start` | bool | false | Allow indexing with different embed config |
| `--profile` | `index start` | enum | balanced | Preset profile: `speed`, `balanced`, or `quality` |
| `--graph` | `index start` | bool | false | Extract structural references for knowledge-graph |
| `--ref1` | `pr-report`, `triage` | ref | HEAD~1 | First ref to compare |
| `--ref2` | `pr-report`, `triage` | ref | HEAD | Second ref to compare |
| `--query` | `pr-report`, `policy-check`, `triage` | string | — | Concept query for analysis |
| `--max-drift` | `policy-check` | float | — | Max allowed concept drift (cosine distance 0–2) |
| `--max-debt-score` | `policy-check` | float | — | Max allowed aggregate debt score |
| `--min-security-score` | `policy-check` | float | — | Min security score threshold |
| `--window` | `ownership` | int | 90 | Days for ownership trend comparison |
| `--repo-a` | `cross-repo-similarity` | path | — | Path to repo A .gitsema/index.db |
| `--repo-b` | `cross-repo-similarity` | path | — | Path to repo B .gitsema/index.db |
| `--diff-file` | `code-review` | path | — | Read diff from patch file instead of git |
| `--lsp` | `index doctor` | bool | false | Only run LSP startup check |
| `--extended` | `index doctor` | bool | false | Run extended pre-flight checks |
| `--no-cache` | `search` | bool | false | Skip query embedding cache |
| `--cache` | `search` | bool | true | Use query embedding cache |
| `--edge-types` | `deps`, `graph cycles`, `graph neighbors`, `unused` | string | varies | Comma-separated edge types to traverse |
| `--reverse` | `deps` | bool | false | Show dependents instead of dependencies |
| `--direction` | `graph neighbors` | enum | both | Edge direction: `out`, `in`, or `both` |
| `--to` | `storage migrate` | enum | — | Destination backend: `sqlite`, `postgres`, or `qdrant` |
| `--to-path` | `storage migrate` | path | — | Destination SQLite database file |
| `--to-metadata-url` | `storage migrate` | url | — | Destination postgres connection string |
| `--to-vectors-url` | `storage migrate` | url | — | Destination Qdrant http(s):// URL |
| `--to-vectors-api-key` | `storage migrate` | string | — | Qdrant API key |
| `--to-fts-backend` | `storage migrate` | enum | tsvector | FTS backend: `tsvector`, `pg_search`, or `none` |
| `--out` | `index export` | path | gitsema-index.tar.gz | Output bundle file path |
| `--in` | `index import` | path | gitsema-index.tar.gz | Input bundle file path |
| `--ef-construction` | `index build-vss` | int | 200 | HNSW ef_construction parameter |
| `--M` | `index build-vss` | int | 16 | HNSW M parameter |
| `--model` | `index build-vss` | string | — | Build index for this model |
| `--sort-by-date` | `search-history` (MCP only) | bool | false | Sort by first-seen date instead of score |
| `--include-content` | `evolution`, `concept-evolution` | bool | false | Add stored file text in JSON output |
| `--include-commits` | `first-seen` | bool | false | Also search commit messages |

### 2.3 Flag Coherence Issues

**Standardization gaps:**

1. **Output flags:**
   - Multiple legacy formats: `--dump [file]`, `--html [file]`, `--format <fmt>`
   - New unified flag: `--out <spec>` (supporting multiple formats)
   - **Status:** Gradual migration to `--out`; legacy flags still supported for backward compat
   - **Action:** Standardize on `--out` across all commands; keep legacy flags as hidden aliases

2. **Result limit:**
   - Uses `--top` or `-k` with varying defaults (some 5, some 10, some 20)
   - **Status:** Mostly consistent at 10
   - **Action:** Standardize all to `--top 10` with consistent `-k` short flag

3. **Model overrides:**
   - Consistently available: `--model`, `--text-model`, `--code-model`
   - **Status:** ✓ Good coherence

4. **Temporal filtering:**
   - `--before`/`--after` (search) vs. `--since` (index: resume point)
   - Aliases: `--since` and `--until`
   - **Status:** Some confusion with dual meaning of `--since`
   - **Action:** Document clearly; consider `--resume-from` for index

5. **Boolean flags:**
   - No consistent naming (e.g., `--no-cache`, `--no-headings`)
   - **Status:** Mostly clear
   - **Action:** Document pattern; maintain consistency

6. **Threshold flags:**
   - Different names across commands: `--threshold`, `--max-drift`, `--max-debt-score`, `--min-security-score`
   - **Status:** Context-specific, acceptable
   - **Action:** No change needed

---

## 3. Interface-Specific Implementation Notes

### CLI (85 commands)
- **Status:** Complete command set
- **Strengths:** Full feature access, all flags available
- **Gaps:** None by definition
- **Output formats:** `--out` (unified), legacy `--dump`/`--html`/`--format`

### REPL (Interactive Search)
- **Status:** Lightweight search loop only (no `--flag` support)
- **Strengths:** Minimal API surface, good for quick iteration
- **Gaps:** No analysis, clustering, graph, workflow commands
- **Output:** Text-only; no structured output
- **Subcommands:** `:top`, `:level`, `:hybrid`, `:help`, `:quit`

### Guide (Agentic Tool-Calling)
- **Status:** 47 tools registered; up to 5 roundtrips
- **Strengths:** Sophisticated multi-step workflows, LLM-driven
- **Gaps:** No maintenance commands (doctor, vacuum, gc), some graph commands, no visualization
- **Constraints:** Max ~4000 chars per result for token budget
- **Tools:** Defined in `guideTools.ts` with schema definitions and executors

### MCP (Model Context Protocol)
- **Status:** 45 tools exposed for external AI clients
- **Strengths:** Standardized protocol, works with Claude, other AI systems
- **Gaps:** No maintenance commands, some graph commands, no visualization
- **Protocol:** Stdio-based (JSON-RPC); `gitsema tools mcp`
- **Future:** MCP HTTP bridge planned (Phase 102+)

### HTTP API (`gitsema tools serve`)
- **Status:** ~30 REST endpoints across multiple routes
- **Strengths:** Language-agnostic, browser-accessible, remote delegation
- **Gaps:** Missing graph commands (callers/callees/neighbors), some analysis endpoints
- **Routes:** `search/`, `analysis/`, `evolution/`, `guide/`, `status/`, `graph/`, `commits/`, `blobs/`, `watch/`, `remote/`
- **Authentication:** Optional bearer token via `--serve-key`

### CLI Interactive (Planned)
- **Status:** Not yet implemented
- **Proposed:** Interactive CLI with tab completion, inline help, command history
- **Expected surface:** All 85 commands, full flag support, interactive feedback

### Web UI (Planned)
- **Status:** Not yet implemented
- **Proposed:** Browser-based interface for search, analysis, visualization
- **Expected surface:** Most CLI commands (visualization focus), subset of flags

### MCP HTTP (Planned)
- **Status:** Not yet implemented
- **Proposed:** MCP protocol over HTTP instead of stdio
- **Expected surface:** Same 45 MCP tools, new HTTP transport

---

## 4. Maintenance & Governance

### When to Update These Tables

Update the parity tables whenever:

1. **A new tool/command is added:**
   - Add row to Tool Parity Matrix
   - Mark available interfaces with ✓
   - Add entry to tool inventory in CLAUDE.md

2. **A tool is removed or deprecated:**
   - Mark as deprecated in table with footnote
   - Document removal in CHANGELOG.md
   - Update features.md

3. **A new interface is enabled:**
   - Add column to Tool Parity Matrix
   - Populate all rows based on support status
   - Update this document's intro

4. **A flag is added, removed, or renamed:**
   - Update §2 (Flags)
   - Document in CHANGELOG.md
   - Update README.md if user-facing

5. **An interface gains/loses tool support:**
   - Update corresponding cell in matrix
   - Document reason (e.g., "phase XYZ pending", "not applicable")
   - File issue or update PLAN.md if a gap

### Single Source of Truth

These tables are authoritative. Keep them in sync with:

- `README.md` (commands, flags)
- `docs/features.md` (feature catalog)
- `docs/PLAN.md` (roadmap, phase status)
- `CLAUDE.md` (tool inventory in § Architecture)
- MCP tool registry (`src/mcp/tools/`)
- CLI command registry (`src/cli/register/`)
- HTTP route registry (`src/server/routes/`)

If you find a discrepancy, **update this file first**, then propagate the change.

### Versioning & Releases

- Updates to this file do NOT require a changeset (documentation)
- Updates that affect user-facing tool availability or flags DO require a changeset
- Use `pnpm exec changeset` and reference the parity table in the summary

---

## 5. Historical Parity Milestones

| Phase | Milestone | Impact |
|---|---|---|
| Phase 8+ | Search interface stabilized | Core parity across CLI, REPL, MCP |
| Phase 41 | Multi-repo support added | `repos` command, search `--repos` flag |
| Phase 80+ | Output format unification | `--out <spec>` introduced; legacy `--dump`/`--html`/`--format` kept |
| Phase 91+ | LLM narrator integration | `--narrate` flag added to select commands |
| Phase 101–103 | Pluggable storage backends | `storage` subcommand; no parity impact (internal) |
| Phase 105+ | Symbol-level search | `--level symbol` added; MCP `code_search` tool |
| Phase 106+ | Structural extraction | `index --graph` flag; MCP tools updated |
| Phase 107+ | Knowledge-graph edges | `graph build`, `graph callers/callees`, etc. |
| Phase 108+ | Graph traversal tools | MCP `call_graph`, `graph_neighbors`, `hotspots` |
| Future | CLI Interactive | Full CLI with autocomplete, history, interactive UI |
| Future | Web UI | Browser-based dashboard with visualization |
| Future | MCP HTTP | HTTP transport for MCP protocol |

---

## 6. Roadmap: Closing Parity Gaps

### Quick Wins (Phase 111+)

- [ ] Add HTTP endpoint for `code-search`
- [ ] Add MCP tool for `cluster-change-points`
- [ ] Standardize `--out` format across all commands (hide legacy flags)
- [ ] Add `--narrate` to `evolution`, `semantic-diff`, `branch-summary`

### Medium-Term (Phase 112+)

- [ ] Expose graph commands (`callers`, `callees`, `neighbors`) to HTTP API
- [ ] Add `cluster-diff`, `cluster-timeline` to MCP/HTTP
- [ ] Implement CLI Interactive with tab completion and inline help
- [ ] Add missing graph commands to Guide tool registry

### Long-Term (Phase 113+)

- [ ] Beta Web UI with visualization (map, heatmap, project)
- [ ] MCP HTTP bridge implementation
- [ ] Full parity across all interfaces (all tools everywhere applicable)

---

**Document Status:** ✓ Current (2026-06-16)  
**Next Review:** When Phase 111+ starts (tool/interface changes)  
**Maintainer:** jsilvanus@gmail.com
