# Skill: gitsema AI Assistant

Use this skill when an AI coding agent needs repository-aware semantic context from `gitsema`. The core value: instead of `grep`-ing or reading dozens of files, run one semantic search to surface the right files in seconds — spending tokens only on what matters.

---

## Core principle: semantic-first codebase discovery

Before reading files, writing code, or asking questions about the codebase, use `gitsema` to:

1. Find which files are semantically relevant to the task
2. Understand where a concept came from and how it evolved
3. Gauge blast radius before editing

This reduces wasted token reads and avoids proposing changes that conflict with existing patterns.

---

## Quick-start decision tree

```
New task arrives
├── "I need to understand X" → semantic_search / search
├── "Where is X implemented?" → code_search (symbol-level)
├── "When did X appear?" → first_seen
├── "How has X changed?" → evolution / file-evolution
├── "Will editing X break Y?" → impact
├── "What is this branch about?" → branch_summary
├── "Something broke recently" → triage
└── "Show me dead/stale code" → dead_concepts
```

---

## MCP tools (preferred when running inside Claude)

Register the MCP server once:

```bash
gitsema tools mcp
```

Then use these tools directly in Claude without spawning subprocesses:

### Search tools

| Tool | Use when | Key params |
|------|----------|------------|
| `semantic_search` | General concept search | `query`, `top_k` (5–10), `hybrid`, `level`, `branch` |
| `code_search` | Search for function/class names or code patterns | `snippet`, `top_k`, `level` |
| `search_history` | Search + Git metadata (dates, commits) | `query`, `top_k`, `before`, `after`, `sort_by_date` |
| `first_seen` | Find when a concept first appeared | `query`, `top_k`, `branch` |
| `multi_repo_search` | Search across registered repos | `query`, `repo_ids`, `top_k` |

### Analysis tools

| Tool | Use when | Key params |
|------|----------|------------|
| `evolution` | Track semantic drift in a specific file | `path`, `threshold` (0.3) |
| `concept_evolution` | Track a concept across the whole codebase | `query`, `top_k`, `threshold` |
| `semantic_diff` | Compare two Git refs semantically | `ref1`, `ref2`, `path` |
| `semantic_blame` | Find who touched a concept | `path` or `query` |
| `impact` | Show what depends on a file/concept | `path` or `query` |
| `change_points` | Detect semantic inflection points | `query`, `top_k`, `threshold` |
| `file_change_points` | Same, scoped to one file | `path`, `threshold` |
| `author` | Attribution for a concept over time | `query`, `top_k` |
| `dead_concepts` | Find stale/deleted code still referenced | `query`, `top_k` |
| `branch_summary` | Semantic overview of a branch vs. main | `branch`, `base_branch`, `top_concepts` |
| `merge_audit` | Detect semantic collisions before merging | `branch_a`, `branch_b`, `threshold` |
| `ownership` | Ownership heatmap | `query`, `top_k`, `window` (days) |
| `experts` | Top contributors to a concept | `query`, `top_k` |
| `triage` | Incident bundle: first-seen + change-points + experts | `query`, `top`, `file` |
| `security_scan` | Find security-pattern similarity | — |
| `debt_score` | Technical debt scoring | — |
| `doc_gap` | Find under-documented areas | — |
| `health_timeline` | Code health metrics over time | — |
| `clusters` | K-means semantic grouping | `k`, `enhanced_labels`, `branch` |

---

## CLI commands (when running outside Claude or scripting)

All commands support `--verbose` / `GITSEMA_VERBOSE=1` for debug output.

### Setup

```bash
gitsema quickstart            # Interactive setup wizard
gitsema status                # Index stats, DB path, model info
gitsema status <path>         # Per-file info
gitsema config list           # All active config values and sources
```

### Indexing

```bash
# Initial full index
gitsema index start

# Incremental (default; picks up from last indexed commit)
gitsema index start --since last

# Full re-index
gitsema index start --since all

# Scope to specific extensions
gitsema index start --ext ts,tsx,go --concurrency 8

# Health check
gitsema index doctor

# Maintenance
gitsema index vacuum
gitsema index gc --dry-run    # Preview unreachable blob cleanup
```

### Search

```bash
# Basic semantic search
gitsema search "<query>" --top 5

# Hybrid (vector + BM25 keyword) — use for mixed natural-language + exact terms
gitsema search "<query>" --hybrid --top 10

# Chunk-level (narrows results to relevant lines, not whole files)
gitsema search "<query>" --level chunk --top 10

# Symbol-level (functions, classes)
gitsema search "<query>" --level symbol --top 10

# Grouped output (de-duplicates by file)
gitsema search "<query>" --group file

# Score breakdown (validate relevance without reading content)
gitsema search "<query>" --explain --top 5

# Date-filtered
gitsema search "<query>" --after 2024-01-01 --before 2024-06-01

# Branch-scoped
gitsema search "<query>" --branch feature/my-branch

# Negative filter (exclude results similar to another concept)
gitsema search "authentication" --not-like "OAuth"

# JSON output for programmatic use
gitsema search "<query>" --out json

# LLM narrative summary of results (reduces need to read all result content)
gitsema search "<query>" --narrate
```

### Code search

```bash
# Search by code patterns / function signatures (uses code model, symbol-level default)
gitsema code-search "function parseJWT"
gitsema code-search "class DatabasePool" --level file
```

### History & evolution

```bash
# When did a concept first appear?
gitsema first-seen "rate limiting"

# How has a file drifted semantically?
gitsema file-evolution src/auth/middleware.ts --threshold 0.3

# Concept drift across entire codebase
gitsema evolution "error handling" --alerts 5

# Semantic distance between two versions of a file
gitsema diff HEAD~10 HEAD src/auth/middleware.ts

# Semantic blame
gitsema blame src/auth/middleware.ts
```

### Impact & ownership

```bash
# Blast radius before editing
gitsema impact src/core/db/sqlite.ts

# Who knows this concept?
gitsema author "database connection pooling"
gitsema experts --top 10
gitsema ownership "payment processing" --window 90
```

### Branch & PR analysis

```bash
# What is this branch about?
gitsema branch-summary feature/new-auth --base-branch main

# Detect semantic collisions before merge
gitsema merge-audit main feature/new-auth --threshold 0.85

# Semantic PR review
gitsema pr-report --ref1 HEAD~1 --ref2 HEAD

# CI gate: fail if concept drifts beyond threshold
gitsema regression-gate --base main --head HEAD --query "payment API"
```

### Incident triage

```bash
# Unified triage bundle (first-seen + change-points + experts)
gitsema triage "database connection timeout"

# Find semantic shift points
gitsema change-points "authentication" --threshold 0.3
```

### Clustering

```bash
# Semantic clusters (understand codebase structure at a glance)
gitsema clusters --k 8 --enhanced-labels

# How did clusters shift between two refs?
gitsema cluster-diff main HEAD --k 8
```

### Maintenance

```bash
gitsema dead-concepts             # Find stale code
gitsema doc-gap --top 20          # Under-documented areas
gitsema debt --top 20             # Technical debt candidates
gitsema refactor-candidates       # Refactoring opportunities
gitsema security-scan             # Security pattern matches (heuristic only)
```

---

## Recommended workflows

### 1. Codebase onboarding (new repo or team member)

```bash
gitsema index start
gitsema status
gitsema clusters --k 10 --enhanced-labels   # Semantic map of the codebase
gitsema evolution "core business logic"      # How the product evolved
gitsema experts --top 10                     # Domain experts per area
```

### 2. Before implementing a feature

```bash
# Find prior art and related implementations
gitsema search "<feature concept>" --hybrid --top 10 --explain

# Find when the concept was introduced
gitsema first-seen "<feature concept>"

# Understand evolution
gitsema evolution "<feature concept>" --alerts 5

# Check blast radius of files you'll touch
gitsema impact <target-file>
```

### 3. Bug investigation

```bash
# Triage bundle: first-seen, change-points, experts
gitsema triage "<error or symptom>"

# When did the pattern break?
gitsema change-points "<broken concept>" --threshold 0.25

# Who can help?
gitsema author "<broken concept>" --top 5
```

### 4. PR review (semantic)

```bash
# What is this branch semantically about?
gitsema branch-summary <branch> --base-branch main

# Will it collide with main?
gitsema merge-audit main <branch> --threshold 0.85

# Full semantic PR report
gitsema pr-report --ref1 main --ref2 <branch>
```

### 5. Refactoring safety check

```bash
# Before touching a file, understand coupling
gitsema impact <file>

# Confirm behavior drift post-refactor
gitsema diff <before-ref> <after-ref> <file>

# Regression gate (usable in CI)
gitsema regression-gate --base main --head HEAD --query "<concept>"
```

### 6. Token-efficient file discovery

```bash
# Find the 3–5 most relevant files to read — don't scan the whole repo
gitsema search "<concept>" --level file --group file --top 5

# Then read only those files
# Result: 1 command instead of cat-ing 20 files
```

---

## Output formats

All commands support `--out <spec>` (repeatable):

```bash
--out text              # Human-readable (default)
--out json              # JSON to stdout
--out json:results.json # JSON to file
--out html:viz.html     # Interactive HTML visualization
--out markdown          # Markdown to stdout
--out sarif:scan.sarif  # SARIF (for security scans / GitHub Code Scanning)
```

Use `--out json` when you need to parse results programmatically or pipe to another tool.

---

## Search result anatomy

```
0.921  src/auth/middleware.ts  [abc1234]  2024-03-15
```

- **Score (0–1):** Semantic similarity. Above ~0.75 is a strong match; below ~0.50 is weak.
- **Path:** File path relative to repo root.
- **Blob hash (7 chars):** Content-addressed identity. Same hash = same content regardless of path/commit.
- **First-seen date:** When this content first appeared in Git history.

For chunk/symbol results:
```
0.891  src/auth/middleware.ts  [abc1234]  2024-03-15  :42-67  parseToken()
```

- `:42-67` = line range
- `parseToken()` = symbol name

---

## Configuration quick reference

### Environment variables (highest precedence)

| Variable | Default | Description |
|----------|---------|-------------|
| `GITSEMA_PROVIDER` | `ollama` | `ollama` or `http` |
| `GITSEMA_MODEL` | `nomic-embed-text` | Default embedding model |
| `GITSEMA_TEXT_MODEL` | `$GITSEMA_MODEL` | Model for prose/docs |
| `GITSEMA_CODE_MODEL` | `$GITSEMA_TEXT_MODEL` | Model for source code |
| `GITSEMA_HTTP_URL` | *(required if http)* | OpenAI-compatible API base URL |
| `GITSEMA_API_KEY` | — | Bearer token |
| `GITSEMA_VERBOSE` | off | Set `1` for debug logging |
| `GITSEMA_LLM_URL` | — | OpenAI-compatible URL for `--narrate` |

### Config file management

```bash
gitsema config list                          # See all values and their sources
gitsema config set index.concurrency 8       # Repo-level default
gitsema config set search.hybrid true --global  # User-global default
gitsema config unset index.concurrency
```

Common config keys: `provider`, `model`, `textModel`, `codeModel`, `httpUrl`, `apiKey`, `index.concurrency`, `index.chunker`, `index.ext`, `search.hybrid`, `search.top`, `evolution.threshold`.

### Ollama quick start

```bash
ollama pull nomic-embed-text
gitsema index start
```

### OpenAI quick start

```bash
export GITSEMA_PROVIDER=http
export GITSEMA_HTTP_URL=https://api.openai.com
export GITSEMA_MODEL=text-embedding-3-small
export GITSEMA_API_KEY=sk-...
gitsema index start
```

### Multi-model routing (separate models for code vs. prose)

```bash
export GITSEMA_TEXT_MODEL=nomic-embed-text
export GITSEMA_CODE_MODEL=codebert-base
gitsema index start
# Code files use codebert, markdown/docs use nomic automatically
```

---

## Model management

### Providers

Gitsema supports three embedding backends:

| Provider | `GITSEMA_PROVIDER` value | Notes |
|----------|--------------------------|-------|
| **Embedeer** | `embedeer` | Primary recommended provider. Local, no API key needed. Requires `@jsilvanus/embedeer` npm package. |
| Ollama | `ollama` | Local via `localhost:11434`. Good fallback if Embedeer is unavailable. |
| HTTP (OpenAI-compatible) | `http` | Any hosted API. Requires `GITSEMA_HTTP_URL` and optionally `GITSEMA_API_KEY`. |

**Embedeer** is the primary way to run models. It handles model downloads, quantization, and optimisation automatically via the `@jsilvanus/embedeer` package:

```bash
npm install @jsilvanus/embedeer   # one-time setup

export GITSEMA_PROVIDER=embedeer
export GITSEMA_MODEL=nomic-ai/nomic-embed-text-v1
gitsema index start
```

### Suggested default model: `nomic-ai/nomic-embed-text-v1`

`nomic-ai/nomic-embed-text-v1` is the recommended default model. It produces high-quality embeddings for both code and prose, but it **requires task instruction prefixes** — unlike models such as OpenAI's `text-embedding-3-small` which work without them.

**Required prefixes for nomic-embed-text-v1:**

| Context | Prefix |
|---------|--------|
| Indexing documents (code files) | `search_document:` |
| Indexing documents (text/prose files) | `search_document:` |
| Search queries | `search_query:` |

Without these prefixes, embedding quality degrades significantly. Gitsema's prefix system applies them automatically once configured — you never add them manually to queries.

### Configuring a model profile with prefixes

Use `gitsema models add` to register a model and its prefixes. This only needs to be done once (stored in `.gitsema/config.json` or `~/.config/gitsema/config.json`):

```bash
# Register nomic-embed-text-v1 with Embedeer + correct prefixes
gitsema models add nomic-ai/nomic-embed-text-v1 \
  --provider embedeer \
  --prefix-code "search_document:" \
  --prefix-text "search_document:" \
  --prefix-query "search_query:" \
  --prefix-other "search_document:" \
  --set-text --set-code

# Confirm the profile was saved
gitsema models info nomic-ai/nomic-embed-text-v1
```

Then index normally:

```bash
gitsema index start
```

Gitsema will prepend `search_document:` to every blob it indexes and `search_query:` to every search query — automatically, for every command and MCP tool.

### Models that do NOT require prefixes

Most OpenAI-compatible models work without prefixes:

```bash
# OpenAI text-embedding-3-small — no prefixes needed
gitsema models add text-embedding-3-small \
  --provider http \
  --url https://api.openai.com \
  --key sk-... \
  --set-text --set-code
```

Do not set prefixes for these models. Adding unnecessary prefixes will reduce embedding quality.

### Full `models` command reference

```bash
gitsema models list                          # List all configured models and their profiles
gitsema models add <name> [options]          # Register/update a model profile
gitsema models info <name>                   # Show full profile for a model
gitsema models remove <name>                 # Remove a model's configuration
```

**`models add` options:**

| Flag | Description |
|------|-------------|
| `--provider ollama\|http\|embedeer` | Backend for this model |
| `--url <url>` | HTTP provider base URL |
| `--key <token>` | API key for HTTP provider |
| `--global-name <id>` | Remote model identifier (when local shorthand differs from remote name) |
| `--prefix-code <str>` | Prefix for code file embeddings (indexing) |
| `--prefix-text <str>` | Prefix for prose/docs embeddings (indexing) |
| `--prefix-query <str>` | Prefix applied to all search queries |
| `--prefix-other <str>` | Prefix for files categorised as "other" |
| `--prefix-type <role=prefix>` | Custom role prefix (repeatable) |
| `--ext-role <ext=role>` | Map file extension to a role (repeatable) |
| `--set-text` | Also set as default text model (`textModel` in config) |
| `--set-code` | Also set as default code model (`codeModel` in config) |
| `--global` | Save to global config (`~/.config/gitsema/config.json`) |

### How prefixes work internally

Gitsema applies prefixes through a `PrefixedProvider` wrapper that prepends the configured string (plus a space) to every text before sending it to the embedding backend. The prefix used depends on the **role** of the input:

- `code` role → `--prefix-code` — applied when indexing source code files
- `text` role → `--prefix-text` — applied when indexing prose/doc files
- `query` role → `--prefix-query` — applied to all search queries
- `other` role → `--prefix-other` — applied to files not classified as code or text

Role assignment is based on file extension using built-in heuristics, overridable per-extension with `--ext-role .ipynb=jupyter`.

Prefixes are **transparent** to the rest of the system: cache keys and DB provenance records use the base model name, not the prefixed variant.

### Switching models

Changing models after indexing requires a full re-index, because embeddings from different models live in separate vector spaces and are not comparable:

```bash
# Clear old embeddings for a specific model
gitsema index clear-model <old-model-name> --yes

# Re-index with new model
export GITSEMA_MODEL=nomic-ai/nomic-embed-text-v1
gitsema index start --since all
```

Or keep both models in the database for multi-model search:

```bash
export GITSEMA_TEXT_MODEL=nomic-ai/nomic-embed-text-v1
export GITSEMA_CODE_MODEL=nomic-ai/nomic-embed-text-v1
gitsema index start   # adds embeddings under the new model name
# Old embeddings remain; queries use the currently configured model
```

---

## Chunking strategies

| Strategy | Flag | Best for |
|----------|------|----------|
| `file` | `--chunker file` | Default; one embedding per file |
| `function` | `--chunker function` | Large files; precise function/class search |
| `fixed` | `--chunker fixed` | Oversize files; adjustable with `--window-size` and `--overlap` |

Auto-fallback chain: `file` → `function` → `fixed 1500` → `fixed 800` (triggered by embedding context-length errors).

Use `--level chunk` or `--level symbol` at search time to query at sub-file granularity (works with any chunker).

---

## Guardrails and caveats

- **`security_scan` / `security-scan` results are similarity scores, not confirmed CVEs.** Treat as heuristic triage signals requiring human review.
- **Re-run `gitsema index start` after major rebases or merges** before analysis. Stale index = stale results.
- **`--hybrid` requires FTS5 content.** Blobs indexed before Phase 11 need `gitsema index backfill-fts` first.
- **`--vss` requires prior `gitsema index build-vss`.** Without it, falls back to linear cosine scan (correct but slower on large indexes).
- **`--branch` filters by reachability, not checkout.** All versions of a blob visible from the branch tip are included.
- **`first-seen` is per blob (content hash), not per path.** A renamed file's first-seen is the date the content first appeared in any path.
- **Scores are not comparable across queries.** Don't compare a 0.8 from one query with a 0.8 from a different query.
- **`--remote <url>` proxies all operations to a gitsema HTTP server.** Local DB is bypassed; useful for shared team servers.
- **Use `--top 5` as a default.** The most relevant results are almost always in the top-5. Increasing `--top` uses more tokens with diminishing returns.

---

## Prompt template for coding agents

Before proposing any code changes, follow this sequence:

```
1. Run semantic search for the requested change or concept.
   gitsema search "<concept>" --hybrid --level chunk --top 5

2. Check first appearance and evolution.
   gitsema first-seen "<concept>"
   gitsema evolution "<concept>" --alerts 3

3. Run impact analysis on files you plan to touch.
   gitsema impact <target-file>

4. Propose changes that preserve existing semantic intent unless explicitly changing behavior.

5. Summarize provenance: which paths, commits, and concepts informed the proposed patch.
```

---

## Anti-patterns to avoid

- **Don't grep the full repo before searching gitsema.** One `gitsema search` call surfaces relevant files without reading any of them.
- **Don't read files you haven't confirmed are relevant.** Use `--level file --group file --top 5` to get a short list, then read only those.
- **Don't skip `gitsema impact` before large refactors.** Silent coupling across modules is exactly what it catches.
- **Don't use `--top 50`+ unless you need exhaustive coverage.** High `--top` floods context without proportional benefit.
- **Don't treat low-scoring results as relevant.** Below ~0.55, treat results as noise unless you have specific reason to investigate.
- **Don't index on every run.** Incremental indexing (`gitsema index start` with no flags) is fast and automatic. Only use `--since all` for model changes or corruption recovery.
