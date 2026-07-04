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

### Ollama for narrator / guide / explain

Ollama's OpenAI-compatible endpoint also works for `narrate`, `explain`, and `guide`
(no API key needed). Pull a tool-capable model (the agentic `guide` loop needs a model
that supports tool/function calling, e.g. `llama3.1` or `qwen2.5`):

```bash
ollama pull llama3.1

# IMPORTANT: use the bare host:port, WITHOUT a trailing /v1 — both the narrator
# (src/core/llm/narrator.ts) and the guide (chattydeer) append /v1/chat/completions
# themselves. A trailing /v1 in --http-url produces a double /v1/v1/... path for guide.
gitsema models add ol-narr --narrator --http-url http://localhost:11434 --activate
gitsema models add ol-guide --guide --http-url http://localhost:11434 --activate

gitsema narrate --narrate
gitsema explain "<topic>" --narrate
gitsema guide "what changed recently?"
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
- **`--hybrid` requires FTS5 content.** Run `gitsema index rebuild-fts` first if blobs are missing FTS rows (`gitsema index backfill-fts` is deprecated as of Phase 128).
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

## Interpreting gitsema tool results

<!-- GENERATED:INTERPRETATIONS START -->

This section is generated from `src/core/narrator/interpretations.ts` (result interpretation) joined with the `GUIDE_TOOLS` definitions in `src/core/narrator/guideTools.ts` (usage) — run `pnpm gen:skill` to regenerate. For each capability: how to use it (what it does + parameters), what the result shape is, and how to read it — what is significant, thresholds, and caveats.

### Repository (git-only, no index required)

**`explain_topic`** — Commits whose subject/body match a topic, for incident/feature investigation.

- Usage: Return commits whose subject/body match a topic, for incident/feature investigation (evidence only — does not call an LLM).
- Parameters: `topic` (required) — Keyword(s) or phrase to search commit messages for.; `since` — Start date or git-recognized date expression.; `until` — End date or git-recognized date expression.
- Result shape: { commitCount, citations[], evidence: [{ hash, date, subject, body, tags[] }] }.
- How to read it: Keyword-matched commit evidence for a topic — useful for "when was X introduced / fixed". Reconstruct a timeline (introduction → fixes → current status) from the matched commits and cite hashes; absence of matches is itself a signal (topic may be named differently).
- Also known as: `explain`, `explain_issue_or_error`

**`narrate_repo`** — Structured commit evidence for a date range / focus (no LLM call inside).

- Usage: Return structured commit evidence for a date range and optional focus (evidence only — does not call an LLM).
- Parameters: `since` — Start date (e.g. "2024-01-01") or git-recognized date expression.; `until` — End date (e.g. "2024-12-31") or git-recognized date expression.; `focus` — Restrict to a category of commits.
- Result shape: { commitCount, citations[], evidence: [{ hash, date, authorName, subject, body, tags[] }] }.
- How to read it: Raw, classified commit evidence — not a summary. `tags` group commits (bugfix, feature, security, deps, performance, ops). Build a narrative FROM this evidence and cite the hashes; do not assert anything the evidence does not support.
- Also known as: `narrate`

**`recent_commits`** — The N most recent commits (hash, date, subject).

- Usage: Fetch the N most recent git commits (hash, date, subject).
- Parameters: `n` — Number of commits to return (default 20, max 100).
- Result shape: { commits: [{ hash, date, subject }] }.
- How to read it: The latest activity. Subjects following conventional-commit prefixes (feat/fix/chore) hint at the change type. Cite the short hash when referencing any commit.

**`repo_stats`** — Branch / tag / commit counts and configured remotes.

- Usage: Basic repository statistics: branch count, tag count, total commit count, and configured remotes.
- Result shape: { branches, tags, commits, remotes[] }.
- How to read it: A quick size/shape orientation for the repo. High commit counts with few branches suggest trunk-based development; many branches may indicate long-lived feature work. Use it to size follow-up queries (e.g. how far back to narrate).

### Search & discovery

**`code_search`** — Symbol/chunk-level search using the code embedding model.

- Usage: Search code using the code embedding model and return symbol/chunk-level matches. The chunk and symbol pools are searched in isolation by default and returned as a `results_by_level` object with independently-ranked lists per level (Phase 137) — pass merge_levels to opt back into one merged `results` array.
- Parameters: `snippet` (required) — Code snippet to embed and search for.; `top_k` — Maximum number of results to return (default 10, max 25).; `branch` — Restrict to blobs on this branch.; `merge_levels` — Merge the chunk/symbol pools into one shared-cutoff results array instead of separate per-level results_by_level lists.
- Result shape: { snippet, results_by_level: { file: [...], chunk: [...], symbol: [...] } } by default — chunk and symbol pools are searched in isolation and returned as separate, independently-ranked lists (Phase 137). Pass merge_levels to get the pre-Phase-137 shape instead: { snippet, results: [{ paths[], score, blobHash }] }.
- How to read it: Like semantic_search but embeds with the code model and targets symbols/chunks — better for finding specific functions/classes from a code snippet than from prose. Higher scores mean closer code-level similarity within a level's own list. Don't rank across levels by raw score — chunk and symbol pools embed differently-framed text (raw excerpt vs. name+signature-annotated), so their scores are not on a directly comparable scale; read each level list separately.

**`cross_repo_similarity`** — Compare semantic search results for the same query across two separate repos.

- Usage: Compare semantic similarity of a concept across two separately indexed gitsema repos by their index.db paths.
- Parameters: `query` (required) — Natural-language concept to compare.; `repo_a` (required) — Path to repo A's .gitsema/index.db.; `repo_b` (required) — Path to repo B's .gitsema/index.db.; `top_k` — Top results per repo (default 5, max 25).
- Result shape: { query, repoA: { path, results[] }, repoB: { path, results[] } }, results: { path, score, blobHash }.
- How to read it: Each side is an independent semantic_search run against its own index — scores are not directly comparable across repos if they use different embedding models. Use it to spot shared concepts, forked/duplicated code, or divergence between two repositories on the same topic.

**`first_seen`** — Find when a concept first appeared (results sorted earliest-first).

- Usage: Find when a concept first appeared in the codebase (results sorted earliest-first).
- Parameters: `query` (required) — Natural-language query describing the concept to search for.; `top_k` — Maximum number of results to return (default 10, max 25).; `hybrid` — Blend vector similarity with BM25 keyword matching.; `branch` — Restrict results to blobs seen on this branch.
- Result shape: Lines "<date>  path  [blob:blobHash]  (score: …)", oldest first.
- How to read it: The earliest dated row is the best evidence for a concept's origin, but only among semantically-matching blobs — confirm relevance via the score before claiming an origin date. Cite the date and short blob hash. The [blob:…] prefix identifies a blob hash (content-addressed) — not a commit hash.

**`multi_repo_search`** — Semantic search across multiple registered gitsema repos.

- Usage: Search across multiple registered gitsema repos (registered via `gitsema repos add`).
- Parameters: `query` (required) — Natural-language query.; `repo_ids` — Repo IDs to search (default: all registered repos with db_path).; `top_k` — Max results (default 10, max 25).
- Result shape: Lines "[repoId] score  path".
- How to read it: Same scoring as semantic_search but spanning repos registered via `gitsema repos add`. The repoId prefix tells you which repo each hit came from; compare scores across repos with care since indexes may use different models.

**`search_history`** — Semantic search enriched with first-seen date / commit, optionally date-sorted.

- Usage: Semantic search enriched with first-seen date and commit, optionally sorted by date.
- Parameters: `query` (required) — Natural-language query to embed and search for.; `top_k` — Maximum number of results to return (default 10, max 25).; `before` — Only include blobs first seen before this date (YYYY-MM-DD).; `after` — Only include blobs first seen after this date (YYYY-MM-DD).; `sort_by_date` — Sort results by first-seen date (ascending) instead of score.; `branch` — Restrict results to blobs seen on this branch.
- Result shape: Rendered "score  path  [blob:blobHash]  first: <date>" lines.
- How to read it: Use when the time dimension matters. Score still ranks relevance; the first-seen date tells you when that content entered history. Date-sorted output surfaces the earliest occurrences. The [blob:…] prefix identifies a blob hash (content-addressed) — not a commit hash.

**`semantic_search`** — Vector similarity search over indexed history.

- Usage: Vector similarity search over the indexed git history. Returns the top matching files/blobs.
- Parameters: `query` (required) — Natural-language search query.; `top_k` — Number of results to return (default 10, max 25).; `branch` — Restrict results to blobs seen on this branch.
- Result shape: { query, results: [{ paths[], score, blobHash }] }.
- How to read it: Ranked by cosine similarity (0–1): roughly >0.75 is a strong match, 0.5–0.75 is related, <0.5 is weak. Each result is a content-addressed blob; the same blob can appear under several paths. Use the top paths as the most relevant files; cite the short blob hash. In text output, hashes appear as [blob:abc1234] — the "blob:" prefix marks these as blob hashes (content-addressed, internal), not commit hashes.

### History & temporal drift

**`activity_heatmap`** — Commit-count activity buckets over time (weekly or monthly).

- Usage: Semantic activity heatmap: count of distinct blob changes per time period (week or month).
- Parameters: `period` — Aggregation period (default "week").
- Result shape: { period, buckets: [{ period, count }] } — most-recent up to 52 buckets.
- How to read it: A simple commit-frequency timeline. Spikes indicate bursts of activity (releases, crunch periods, large refactors); long flat/zero stretches indicate dormancy. Use alongside narrate_repo or change_points to explain what drove a spike.

**`change_points`** — The largest historical shifts of a concept across the codebase.

- Usage: Find the historical moments when a semantic concept underwent its largest shifts across the codebase.
- Parameters: `query` (required) — Natural-language concept to track.; `top_k` — Number of top-matching blobs to scan (default 50).; `threshold` — Cosine distance threshold for flagging a change point (default 0.3).; `top_points` — Number of change points to return (default 5).; `branch` — Restrict to blobs seen on this branch.
- Result shape: { points: [{ before, after, distance }] } sorted by distance.
- How to read it: Each point is a before→after jump; larger `distance` (cosine) = bigger semantic shift. The top points are the moments the concept changed most — cite the after-commit hash and inspect those commits to explain what changed. Few/no points means the concept has been stable.

**`concept_evolution`** — How a semantic concept evolved across the whole codebase.

- Usage: Show how a semantic concept has evolved across the entire commit history.
- Parameters: `query` (required) — Natural-language concept to trace, e.g. "authentication".; `top_k` — Number of top-matching blobs to include (default 50).; `threshold` — Cosine distance threshold above which a step is flagged as a large change (default 0.3).
- Result shape: Chronological entries with paths, score, distFromPrev per step.
- How to read it: Traces a concept (not one file) over time. `score` is relevance to the query; `distFromPrev` flags where the concept's representation shifted (≥ threshold = large change). Read it as the concept's storyline: where it emerged, where it was reworked, and into which files it spread.

**`concept_lifecycle`** — A concept's lifecycle stage over time: emergence, growth, maturity, decline.

- Usage: Analyze the lifecycle stages (born → growing → mature → declining → dead) of a semantic concept across Git history.
- Parameters: `query` (required) — Natural-language concept to trace.; `steps` — Number of time windows to sample (default 10).; `threshold` — Cosine similarity threshold for a "match" (0-1, default 0.7).
- Result shape: { query, bornTimestamp, peakTimestamp, peakCount, currentStage, isDead, points[] }.
- How to read it: Each point has a date, lifecycle `stage`, match count, and growth rate. Read it as a story: when the concept was born, when it peaked, and its current stage/growth trend. `isDead` flags concepts with no recent matches — useful for spotting abandoned ideas vs. ones still actively developed.
- Also known as: `lifecycle`, `concept-lifecycle`

**`file_change_points`** — Inflection points in a single file's semantic history.

- Usage: Detect semantic change points in a single file's Git history.
- Parameters: `path` (required) — File path to analyze.; `threshold` — Cosine distance threshold to emit a change point (default 0.3).; `top_points` — Number of change points to return (default 5).; `branch` — Restrict to this branch.
- Result shape: { points: [{ before, after, distance }] } per file.
- How to read it: File-scoped version of change_points: the dates where the file changed most in meaning. Use the before/after blob hashes to diff what actually changed at each inflection.

**`file_evolution`** — Semantic drift timeline of a single file across its history.

- Usage: Track a single file's semantic drift across its Git history.
- Parameters: `path` (required) — File path relative to the repo root, e.g. "src/auth/oauth.ts".; `threshold` — Cosine distance threshold above which a version is flagged as a large change (default 0.3).
- Result shape: Timeline of versions with distFromPrev / distFromOrigin per step.
- How to read it: Each step is a version; `distFromPrev` (cosine, 0–2) is how much it changed from the prior version and `distFromOrigin` is cumulative drift. Steps at/above the threshold (default 0.3) are large changes worth explaining — correlate their dates/commits with what happened. Steady small distances mean incremental change; a spike means a rewrite or repurposing.
- Also known as: `evolution`

**`health_timeline`** — Time-bucketed codebase health: active blobs, churn rate, dead-concept ratio.

- Usage: Time-bucketed codebase health metrics: active blob count, semantic churn rate, and dead-concept ratio.
- Parameters: `buckets` — Number of time buckets (default 12).; `branch` — Restrict to commits on this branch.
- Result shape: Per-bucket rows: active count, semanticChurnRate, deadConceptRatio.
- How to read it: Rising churn means more concept turnover; a rising dead-concept ratio means more stale/removed code. Read the trend, not single buckets — sustained high churn or a growing dead ratio are health concerns; stable low values indicate maturity.

**`semantic_bisect`** — Binary search over commit history for where a concept shifted most from a "good" baseline.

- Usage: Binary search over commit history to find where a concept diverged from a "good" baseline (semantic git bisect).
- Parameters: `good_ref` (required) — A git ref known to be "good" (baseline) — branch, tag, commit hash, or date.; `bad_ref` (required) — A git ref known to be "bad" (where the concept has drifted).; `query` (required) — Natural-language concept to track.; `top_k` — Top-K blobs used to compute the concept centroid at each step (default 20).; `max_steps` — Maximum bisect steps (default 10).
- Result shape: { query, goodRef, badRef, culpritRef, maxShift, steps: [{ ref, date, blobCount, distanceFromGood }] }.
- How to read it: `culpritRef` is the bisection's best guess for when the concept diverged from the good baseline; `maxShift` (cosine distance) is the size of the largest jump found. Steps show the search path — higher `distanceFromGood` values mark candidates closer to the regression. Treat the culprit as a narrowed time window to investigate further (e.g. with change_points or file_evolution), not a definitive single commit.

### Branch & merge analysis

**`branch_summary`** — What a branch is semantically about vs its base.

- Usage: Generate a semantic summary of what a branch is about compared to its base branch.
- Parameters: `branch` (required) — Branch to summarise (short name, e.g. "feature/auth").; `base_branch` — Base branch to compare against (default "main").; `top_concepts` — Number of nearest concept clusters to return (default 5).
- Result shape: { branch, baseBranch, mergeBase, exclusiveBlobCount, nearestConcepts[], topChangedPaths[] }.
- How to read it: Describes a branch from its base-exclusive blobs. `nearestConcepts` (with similarity) name what the branch is about; `topChangedPaths` (with drift) are where it diverges most. exclusiveBlobCount=0 means the branch adds nothing new vs base (or is not indexed).

**`merge_audit`** — Semantic collisions between two branches (same concept, different files).

- Usage: Detect semantic collisions between two branches — pairs of files about the same concept even without shared lines.
- Parameters: `branch_a` (required) — First branch name (e.g. "feature/auth").; `branch_b` (required) — Second branch name (e.g. "feature/payments").; `threshold` — Cosine similarity threshold for a collision (0-1, default 0.85).; `top_k` — Maximum collision pairs to return (default 20).
- Result shape: { blobCountA/B, centroidSimilarity, collisionZones[], collisionPairs[] }.
- How to read it: Collision pairs are files on each branch that are semantically close (similarity ≥ threshold, default 0.85) even without shared lines — likely conflict/duplication risks at merge. High centroid similarity means the branches overlap broadly. Review the top pairs before merging.

**`merge_preview`** — Predicted concept-cluster landscape shift after a merge.

- Usage: Predict how the semantic concept landscape will shift after merging a branch.
- Parameters: `branch` (required) — Branch to merge (e.g. "feature/auth").; `into` — Target branch to merge into (default "main").; `k` — Number of semantic clusters to compute (default 8).
- Result shape: { before/after totals, new/removed/moved/stable counts, changes[] }.
- How to read it: Forecasts how clusters change post-merge. [NEW]/[DISSOLVED] clusters and high centroid drift indicate the merge meaningfully reshapes the architecture; mostly-stable clusters indicate a low-impact merge.

### Ownership & expertise

**`author`** — Which authors contributed most to a concept.

- Usage: Find which authors have contributed most to a semantic concept in the codebase.
- Parameters: `query` (required) — Natural-language concept to attribute.; `top_k` — Number of top blobs to attribute (default 50).; `top_authors` — Number of top authors to return (default 10).; `branch` — Restrict to blobs seen on this branch.
- Result shape: Authors with totalScore and blobCount for the query.
- How to read it: `totalScore` aggregates relevance-weighted contribution to the concept; `blobCount` is how many matching blobs they touched. The top author is the best person to ask about that concept — but attribution is by indexed blobs, so it reflects content, not lines of code.

**`contributor_profile`** — What a contributor specialises in (centroid of their work).

- Usage: Show what a contributor specialises in — the top blobs nearest the semantic centroid of all blobs they've touched.
- Parameters: `author` (required) — Author name or email (substring match).; `top_k` — Number of blobs to return (default 10).; `branch` — Restrict to blobs on this branch.
- Result shape: Top blobs nearest the semantic centroid of the author's touched blobs.
- How to read it: The returned blobs characterise the author's focus area. Treat it as "what this person works on", not an exhaustive list of their commits.

**`experts`** — Top contributors by semantic area (which clusters they work on).

- Usage: List top contributors by semantic area (which concepts/clusters they work on).
- Parameters: `top_n` — Number of top contributors to return (default 10).; `since` — Only include activity after this date (YYYY-MM-DD).; `until` — Only include activity before this date (YYYY-MM-DD).; `min_blobs` — Minimum blob count to include a contributor (default 1).; `top_clusters` — Max semantic clusters per contributor (default 5).
- Result shape: Contributors with blobCount and their top clusters.
- How to read it: Maps people to the concept clusters they own. Requires clusters to exist (run `clusters` first). Use it to route work or find reviewers by area rather than by file paths.

**`ownership`** — Ownership heatmap: authors ranked by share of a concept.

- Usage: Ownership heatmap: ranks authors by their share of touched blobs for a semantic concept.
- Parameters: `query` (required) — Natural-language concept query.; `top` — Number of top owners to return (default 5).; `window_days` — Time window for recent activity in days (default 90).
- Result shape: Authors with their share (0–1) of touched blobs for the query.
- How to read it: A high share for one author means concentrated ownership (bus-factor risk); a flat distribution means shared ownership. The window_days option biases toward recent activity.

### Quality, debt & risk

**`blast_radius`** — What changes if you touch a symbol/file — structural dependents and/or semantic neighbours.

- Usage: What changes if I touch this symbol/file: structural dependents (who references it) and/or semantically related blobs, selected by lens (requires `gitsema index --graph` + `gitsema graph build`).
- Parameters: `symbol` (required) — Symbol qualified name, file path, or literal node key.; `lens` — Which lens(es) drive the result (default hybrid).; `top_k` — Number of semantic results (default 10, max 25).
- Result shape: { symbol, lens, structural: [{ node, displayName, depth, edgeType }], semantic: [{ path, symbolName, score }], semanticSupported }.
- How to read it: The `lens` selects the view: `structural` lists real dependents (who references this, via calls/imports/extends/implements/references); `semantic` lists conceptually related blobs; `hybrid` (default) shows both. Use structural for "what must I retest", semantic for "what else encodes this idea". The structural upgrade to `impact`. Requires the built graph; `semanticSupported:false` means the backend cannot serve the semantic lens.

**`call_graph`** — Structural callers/callees of a symbol over the knowledge graph.

- Usage: Structural call-graph traversal over the knowledge graph (requires `gitsema index --graph` + `gitsema graph build`): who calls (callers) or is called by (callees) a symbol.
- Parameters: `symbol` (required) — Symbol qualified name, file path, or literal node key (file:..., symbol:..., external:...).; `direction` — Traverse reverse (callers) or forward (callees) calls edges.; `depth` — Traversal depth (default and max 3).
- Result shape: { symbol, direction, hits: [{ node, displayName, depth, edgeType }] } — reverse (callers) or forward (callees) `calls` traversal.
- How to read it: This is the STRUCTURAL lens — real `calls` edges, not semantic similarity. `depth` is the hop count from the queried symbol (capped at 3). Requires `gitsema index --graph` + `gitsema graph build`; an empty/error result usually means the graph has not been built. Resolution is best-effort (confidence tiers), so cross-file/dynamic calls may be missing or land on `external:` nodes.

**`dead_concepts`** — Blobs that existed historically but are no longer reachable from HEAD.

- Usage: Find blobs that existed historically but are no longer reachable from HEAD — deleted or removed concepts.
- Parameters: `top_k` — Number of dead blobs to return (default 10).; `branch` — Restrict to blobs seen on this branch.
- Result shape: Removed blobs with last-seen date and last-seen commit message.
- How to read it: These are deleted/removed concepts. Useful for "what did we used to have" and for spotting capabilities that were dropped. The last-seen date/commit explains when and (often) why it went away.

**`debt_score`** — Technical-debt ranking by isolation, age, and low change frequency.

- Usage: Score blobs by technical debt: isolation, age, and low change frequency.
- Parameters: `top` — Number of top-debt blobs to return (default 20).; `branch` — Restrict to blobs on this branch.
- Result shape: Blobs with debtScore plus isolationScore, ageScore, changeFrequency.
- How to read it: Higher debtScore = more likely neglected/risky. It combines semantic isolation (few neighbours), age, and rarely-changed status — so old, lonely, untouched code rises to the top. It is a heuristic prioritiser for review, not proof of a defect.

**`doc_gap`** — Code blobs with the least documentation coverage.

- Usage: Find code blobs with insufficient documentation coverage vs. prose/docs blobs in the index.
- Parameters: `top_k` — Number of underdocumented blobs to return (default 20).; `threshold` — Maximum doc-similarity to include (lower = less documented).; `branch` — Restrict to blobs on this branch.
- Result shape: Code blobs with their maximum similarity to any doc blob (lower = worse).
- How to read it: A low max-doc-similarity means no documentation blob resembles this code — a documentation gap. Prioritise the lowest-scoring, most-important files for docs.

**`hotspots`** — Architectural risk = co-change (temporal) × call-coupling (structural) × churn.

- Usage: Rank files by architectural risk = co-change (temporal) × call-coupling (structural) × churn, over the knowledge graph (requires `gitsema index --graph` + `gitsema graph build`). Default lens hybrid.
- Parameters: `lens` — Which lens(es) drive the risk score (default hybrid).; `top_k` — Number of hotspots to return (default 20, max 50).
- Result shape: { lens, hotspots: [{ path, risk, lenses, coChange, coupling, churn }] } sorted by risk (desc).
- How to read it: `risk` is a geometric mean in [0,1] of the normalized signals the lens selects (`hybrid` = all three; `structural` = coupling only; `semantic` = co-change × churn), so a file must score on every participating axis to rank highly. High-risk files are heavily coupled AND change often AND co-change with many others — prime refactor/test-hardening targets. The `lenses` tag shows which signals contributed. Requires `gitsema index --graph` + `gitsema graph build`.

**`impact`** — Blobs most semantically coupled to a file.

- Usage: Find blobs most semantically coupled to a file — what else will be affected by changing it.
- Parameters: `file` (required) — Path to the file to analyse (relative to repo root).; `top_k` — Number of similar blobs to return (default 10).; `branch` — Restrict to blobs seen on this branch.
- Result shape: Neighbours with similarity score for the target file.
- How to read it: The high-score neighbours are what else is likely affected by changing this file, even without an import edge. Use it to scope a change's blast radius and pick what to test/review alongside it.

**`refactor_candidates`** — Pairs of symbols/chunks/files that are near-duplicates by embedding similarity.

- Usage: Find pairs of symbols/chunks/files that are semantically similar enough to be refactoring candidates.
- Parameters: `threshold` — Cosine similarity threshold for a candidate pair (0-1, default 0.88).; `top_k` — Maximum pairs to return (default 50, max 50).; `level` — Search granularity (default "symbol").
- Result shape: { threshold, level, totalScanned, pairs: [{ similarity, a, b }] } (top 20 by similarity).
- How to read it: High `similarity` (near the threshold, default 0.88, max 1.0) means the two items (`a`/`b`, shown as `path::symbolName` or `path`) are likely duplicated or near-duplicated logic — candidates for extraction into a shared helper. `level` (symbol/chunk/file) sets the granularity. Not every pair is worth merging — check whether the duplication is incidental (e.g. boilerplate) or meaningful.

**`security_scan`** — Blobs semantically similar to common vulnerability patterns.

- Usage: Scan the codebase for blobs semantically similar to common vulnerability patterns. Results are similarity scores, NOT confirmed vulnerabilities.
- Parameters: `top` — Number of results per pattern (default 10).
- Result shape: Findings with patternName, similarity score, and path.
- How to read it: These are SIMILARITY scores, NOT confirmed vulnerabilities — every finding needs manual review. Treat higher scores as "review this first" and group by patternName to see which risk classes dominate. Never report a finding as a confirmed CVE.

### Diff & blame

**`file_diff`** — Cosine distance between two versions of a single file at two refs, with optional neighbours.

- Usage: Compute the semantic diff (cosine distance) between two versions of a single file at two git refs.
- Parameters: `ref1` (required) — Earlier git ref (branch, tag, commit hash, or date).; `ref2` (required) — Later git ref.; `path` (required) — File path relative to the repo root.; `neighbors` — Number of nearest-neighbour blobs to show for each version (default 0).
- Result shape: { ref1, ref2, path, blobHash1, blobHash2, cosineDistance, neighbors1?, neighbors2? }, neighbors: { path, blobHash, distance }.
- How to read it: `cosineDistance` (0–2) measures how much the file changed in meaning between the two refs — near 0 means semantically unchanged (even if the text differs), higher values mean substantive rewrites. `neighbors1`/`neighbors2` (if requested) show the closest other blobs to each version — useful for spotting that a file was effectively replaced by, or merged from, another file.

**`semantic_blame`** — Per-block nearest-neighbour attribution for a file.

- Usage: Show the semantic origin of each logical block in a file — finds nearest-neighbor blobs in the index.
- Parameters: `file_path` (required) — Path to the file to blame.; `top_k` — Neighbors per block (default 3).; `level` — Granularity level (default "file").; `branch` — Restrict to blobs seen on this branch.
- Result shape: Per logical block: nearest indexed blobs with similarity, commit, author.
- How to read it: For each block it shows the most semantically similar indexed blobs and their commits/authors — i.e. where that block's ideas come from, which can differ from git blame (line authorship). High similarity points to the true conceptual origin even after refactors.

**`semantic_diff`** — Conceptual diff of a topic across two refs (gained / lost / stable).

- Usage: Compute a conceptual/semantic diff of a topic across two git refs — shows gained, lost, and stable concepts.
- Parameters: `ref1` (required) — Earlier git ref (branch, tag, commit hash, or date).; `ref2` (required) — Later git ref.; `query` (required) — Topic query to embed and compare.; `top_k` — Number of results per category (default 10).; `branch` — Restrict to blobs seen on this branch.
- Result shape: { topic, ref1, ref2, gained[], lost[], stable[] }.
- How to read it: `gained` are blobs relevant to the topic that appear by ref2, `lost` are ones present at ref1 but gone by ref2, `stable` persist. Read it as how the topic's footprint changed between the two points; cite the blob hashes and dates.

### Clustering

**`cluster_change_points`** — Detects commits where the cluster/concept landscape shifted most.

- Usage: Detect change points in the repo's cluster structure across commit history.
- Parameters: `k` — Number of clusters per step (default 8).; `threshold` — Mean centroid shift threshold to flag a change point (cosine distance, 0-2, default 0.3).; `top_points` — Number of change points to return (default 5).; `since` — Limit commits from this point; date or git-recognized expression.; `until` — Limit commits up to this point; date or git-recognized expression.; `max_commits` — Cap the number of commits evaluated (sampled evenly across the range).
- Result shape: { k, threshold, range, points: [{ before: {ref, clusters}, after: {ref, clusters}, shiftScore, topMovingPairs }] }.
- How to read it: Each point is a before/after pair of cluster snapshots with a `shiftScore` — higher means a bigger reorganisation of the concept map at that point. `topMovingPairs` names which clusters grew/shrank most. Use the highest-scoring points as candidates for "this is when the architecture changed".

**`cluster_diff`** — Compare cluster structure at two refs.

- Usage: Compare semantic clusters between two points in history.
- Parameters: `ref1` (required) — Earlier git ref.; `ref2` (required) — Later git ref.; `k` — Number of clusters to compute (default 8).
- Result shape: JSON report of new/removed/moved/stable blobs and per-cluster changes.
- How to read it: Shows how the concept map reorganised between two points: new/dissolved clusters and blobs that migrated between concepts. Large movements indicate architectural restructuring.

**`cluster_timeline`** — Multi-step cluster drift over commit history.

- Usage: Track how semantic clusters evolve through commit history.
- Parameters: `since` — Start date or git-recognized date expression.; `until` — End date or git-recognized date expression.; `k` — Number of clusters per step (default 4).; `branch` — Restrict to commits on this branch.
- Result shape: JSON report with per-step cluster snapshots and movement stats.
- How to read it: A sequence of cluster snapshots. Read it for trends — acceleration (lots of movement) vs stabilisation (little) — to characterise the project's structural trajectory over time.

**`clusters`** — K-means grouping of all blobs into semantic clusters.

- Usage: Cluster all indexed blobs into K semantic groups using k-means and return labels, sizes, and representative paths.
- Parameters: `k` — Number of clusters to compute (default 8).; `branch` — Restrict clustering to blobs seen on this branch.
- Result shape: Clusters with label, size, keywords, representative paths.
- How to read it: A bird's-eye map of the codebase's concept areas. Large clusters are dominant concerns; the keywords/representative paths name each area. Use it for onboarding and to see whether the code is cleanly separated or tangled. `k` controls granularity.

**`semantic_map`** — Snapshot of the current cluster layout (requires a prior `clusters` run).

- Usage: Semantic codebase map: the most recent k-means cluster snapshot (labels, sizes, representative paths) and blob-assignment counts per cluster.
- Result shape: { clusters: [{ id, label, size, representativePaths(top 3), assignedBlobCount }] } or { error } if no snapshot exists.
- How to read it: A static view of the most recent cluster snapshot — `label` and `representativePaths` name each concept area, `size`/`assignedBlobCount` show its weight. If `error` is returned, no snapshot exists yet; suggest running `gitsema clusters` first. Use this for a quick "what areas exist" overview without recomputing clusters.

### Compound workflows

**`cherry_pick_suggest`** — Suggests commits most semantically relevant to a query, as cherry-pick candidates.

- Usage: Suggest commits to cherry-pick based on semantic similarity of their commit messages to a query.
- Parameters: `query` (required) — Natural-language description of the change to find.; `top_k` — Number of results to return (default 10, max 25).
- Result shape: { query, results: [{ commitHash, score, message, paths[] }] }.
- How to read it: Ranked by relevance to the query (higher `score` = more relevant). Each result is a candidate commit to cherry-pick onto another branch — check `paths` for what it touches and `message` for intent before recommending it; relevance does not guarantee the commit applies cleanly elsewhere.

**`eval`** — Retrieval evaluation: precision@k, recall@k, MRR for a test set.

- Usage: Retrieval evaluation harness: given (query, expected paths) test cases, returns precision@k, recall@k, and MRR for the current index.
- Parameters: `cases` (required) — Evaluation test cases.; `top` — k for P@k / R@k (default 10).
- Result shape: Aggregate P@k / R@k / MRR plus per-case metrics.
- How to read it: Measures index retrieval quality against expected paths. Higher is better (1.0 = perfect). Low precision means noisy results; low recall means relevant files are missed; low MRR means correct hits rank too far down. Use it to compare models/chunkers.

**`policy_check`** — CI gate: debt, security, and drift thresholds → pass/fail.

- Usage: CI policy gate: check index health against thresholds for debt score, security similarity, and concept drift. Returns pass/fail for each gate.
- Parameters: `max_debt_score` — Fail if average debt score exceeds this threshold (0-1).; `min_security_score` — Fail if max security similarity exceeds this threshold (0-1).; `max_drift` — Fail if max concept drift distance exceeds this threshold (0-2, requires query).; `query` — Query for drift analysis (required when max_drift is set).
- Result shape: { passed, checks: { debt?, security?, drift? } }.
- How to read it: Each gate reports its measured value and pass/fail vs the threshold you set. `passed:false` on any gate fails the check (exit code 3 on the CLI). Report which gate failed and by how much.

**`pr_report`** — Compound PR-review bundle: semantic diff, impacted modules, change points, and reviewer suggestions.

- Usage: Compose a semantic PR report: diff summary and impacted modules for a file, change-point highlights for a concept query, and suggested reviewers.
- Parameters: `ref1` — Base ref (default "HEAD~1").; `ref2` — Head ref (default "HEAD").; `file` — File path to analyze for semantic diff and impact.; `query` — Concept query for change-point highlights.; `top` — Result limit per section (default 10, max 25).; `since` — Filter reviewer activity since this date.; `until` — Filter reviewer activity until this date.
- Result shape: { ref1, ref2, semanticDiff?, impactedModules?, changePoints?, reviewerSuggestions }; sections may be { error } if unavailable.
- How to read it: Combine the sections into a review summary: `semanticDiff` (gained/lost/stable concepts between refs) frames what changed conceptually, `impactedModules` shows blast radius, `changePoints` flags any large historical shifts in the affected area, and `reviewerSuggestions` names people to involve. A section returning `{error}` just means that part could not be computed (e.g. no query given) — report on the remaining sections.

**`triage`** — Incident bundle: first-seen, change points, experts (+ optional file evolution).

- Usage: Incident/issue triage bundle: first-seen, change points, experts, and optional file evolution for a query.
- Parameters: `query` (required) — Natural-language query describing the issue or incident.; `top` — Max results per section (default 5).; `file` — Optional file path for file-level evolution analysis.
- Result shape: Sections: firstSeen, changePoints, experts, optional fileEvolution.
- How to read it: A one-shot investigation bundle. Cross-reference the sections: first-seen tells you where the concept lives, change points tell you when it shifted (suspect commits), experts tell you who to ask. Synthesize across sections rather than reporting each in isolation.

**`workflow_run`** — Run a named template (pr-review | incident | release-audit).

- Usage: Run a named workflow template (pr-review | incident | release-audit) and return all sections of the analysis bundle.
- Parameters: `template` (required) — Workflow template to run.; `query` — Query string (required for incident and release-audit).; `file` — File path (used by pr-review for impact analysis).; `top` — Max results per section (default 5).
- Result shape: Template-specific sections (impact / changePoints / experts / firstSeen …).
- How to read it: Bundles several analyses for a scenario. Read each section per its own capability's guidance (impact, change_points, experts, etc.) and combine into one narrative for the template's purpose.

### Administration

**`index`** — Index / incrementally re-index the repo (mutating, can be slow/expensive).

- Usage: Index (or incrementally re-index) the Git repository at the current working directory. This is a WRITE operation that embeds blobs — only run it when the index is missing or stale.
- Parameters: `since` — Only index commits after this point; a date, tag, commit hash, or "all" to force a full re-index.; `concurrency` — Number of blobs to embed concurrently (default 4).
- Result shape: Stats: seen, indexed, skipped, oversized, filtered, failed, commits.
- How to read it: A WRITE operation that embeds blobs — only run it when the index is missing or stale, and prefer asking the user first for large repos. `indexed` is new work done; a high `failed` count points to an unreachable embedding provider.

<!-- GENERATED:INTERPRETATIONS END -->

## Using `gitsema guide` (agentic Q&A)

`gitsema guide [question]` is an interactive LLM chat that answers questions about
this repository. It always prints gathered git context (recent commits, repo stats);
if a guide (or fallback narrator) model is configured, it also runs a real
**agentic tool-calling loop** (`@jsilvanus/chattydeer` `runAgentLoop`, up to 5
roundtrips) that can call the **full gitsema toolset** — every capability listed
above in "Interpreting gitsema tool results" — to gather evidence before answering.

```bash
# Single-shot question
gitsema guide "what changed in the auth module recently?"

# Multi-turn REPL — one agent session reused across turns
gitsema guide --interactive

# Skip git-context gathering (faster, less grounded)
gitsema guide "..." --no-context
```

- **Safe-by-default:** with no guide/narrator model configured, `guide` prints the
  gathered context and exits — no network access occurs.
- **Index-gated tools:** capabilities that need a `.gitsema` index (search, evolution,
  clustering, ownership, etc.) return `{"error": "..."}` gracefully if no index exists;
  the agent falls back to git-only tools (`repo_stats`, `recent_commits`, `narrate_repo`,
  `explain_topic`) and tells the user to run `gitsema index` first.
- **Redaction:** every prompt and tool result is passed through the same secret/PII
  redaction (`redactAll`) as `narrate`/`explain` before reaching the LLM.
- Configure a guide model: `gitsema models add <name> --guide --http-url <url> [--key <token>] --activate`.

---

## Anti-patterns to avoid

- **Don't grep the full repo before searching gitsema.** One `gitsema search` call surfaces relevant files without reading any of them.
- **Don't read files you haven't confirmed are relevant.** Use `--level file --group file --top 5` to get a short list, then read only those.
- **Don't skip `gitsema impact` before large refactors.** Silent coupling across modules is exactly what it catches.
- **Don't use `--top 50`+ unless you need exhaustive coverage.** High `--top` floods context without proportional benefit.
- **Don't treat low-scoring results as relevant.** Below ~0.55, treat results as noise unless you have specific reason to investigate.
- **Don't index on every run.** Incremental indexing (`gitsema index start` with no flags) is fast and automatic. Only use `--since all` for model changes or corruption recovery.
