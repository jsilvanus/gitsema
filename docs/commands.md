# gitsema Command Reference & Grouping Analysis

## Current command inventory

gitsema has 18 commands. As of the analysis below they fall into five implicit groups. There is no explicit grouping in the CLI help output today — commands are listed in registration order.

| Command | Input type | What it does |
|---|---|---|
| `status` | — | Show index statistics and database path |
| `index` | — | Walk Git history and embed all blobs |
| `backfill-fts` | — | Populate FTS5 content for older index entries |
| `serve` | — | Start HTTP embedding/storage server |
| `remote-index` | repo URL | Ask a remote server to clone and index a repo |
| `search` | query | Vector similarity search |
| `first-seen` | query | Find when a concept first appeared (sorted oldest-first) |
| `dead-concepts` | — | Find deleted blobs still similar to HEAD |
| `impact` | file path | Cross-module coupling via vector similarity |
| `evolution` | file path | Semantic drift of one file across its Git history |
| `diff` | ref1 ref2 path | Cosine distance between two versions of a file |
| `semantic-blame` | file path | Per-block nearest-neighbor attribution |
| `concept-evolution` | query | How a semantic concept evolved across all commits |
| `clusters` | — | K-means clustering of all blob embeddings |
| `cluster-diff` | ref1 ref2 | Compare cluster snapshots at two points in time |
| `cluster-timeline` | — | Multi-step cluster drift over the full commit history |
| `mcp` | — | Start MCP stdio server |

---

## Analysis of current groupings

### The "evolution" family

Two commands share the word *evolution* but operate on fundamentally different units:

- **`evolution <path>`** — answers "how did *this file* change semantically over time?" Input is a concrete file path; output is one row per indexed version of that file.
- **`concept-evolution <query>`** — answers "when did *this concept* appear and drift across the entire codebase?" Input is a freeform text query; output is a cross-file timeline sorted by commit date.

The shared suffix implies they are siblings in the same family, but they differ on:

| Dimension | `evolution` | `concept-evolution` |
|---|---|---|
| Input | File path | Text query |
| Scope | Single file | Entire codebase |
| Question answered | How did this file drift? | How did this concept spread? |
| Related command | `diff` (two-point version of it) | `first-seen` (single-point version of it) |

The name `concept-evolution` is descriptive on its own, but sitting next to `evolution` it creates the impression they are the same operation at different granularities, which they are not.

### The "cluster" family

Three commands handle K-means clustering:

- **`clusters`** — static snapshot at HEAD.
- **`cluster-diff`** — compare two snapshots (ref1 vs ref2).
- **`cluster-timeline`** — multi-step drift across the full history.

The `-diff` and `-timeline` commands are *temporal* variants of `clusters`. Their names match the pattern of `evolution`/`concept-evolution`, so they are comparatively clear. The main question is whether they belong in the same group as static `clusters` or under a dedicated temporal heading.

### Missing explicit grouping in CLI help

Running `gitsema --help` today prints commands in registration order with no group headers. A user reading the list cannot easily distinguish analysis commands from infrastructure commands, or file-centric from concept-centric operations.

---

## Findings

1. **`evolution` and `concept-evolution` look like the same operation at different granularities, but they are not.** `evolution` is file-history; `concept-evolution` is concept-search-over-time. The naming is not wrong, but it invites confusion.

2. **The cluster commands are well-named internally** (`clusters`, `cluster-diff`, `cluster-timeline`) but visually disconnected from `concept-evolution` and `cluster-timeline`, which both answer "how did X change over time?"

3. **No explicit group structure is surfaced to users.** The README and CLI help list commands sequentially, making it hard to find the right tool for a task.

4. **`first-seen` is a natural companion to `concept-evolution`** — one finds the origin, the other traces the arc — but they are not grouped together.

5. **`dead-concepts` and `impact` are orphans.** They are codebase-level analytical tools with no natural group in the current listing.

---

## Proposed groupings

Rather than renaming commands (which would be a breaking change), the most actionable improvement is to apply explicit group headers in the CLI help and in documentation. Renames that *are* worth considering are noted below.

### Group 1 — Setup & Infrastructure

Commands that configure and maintain the index itself.

| Command | Notes |
|---|---|
| `status` | |
| `index` | |
| `backfill-fts` | |
| `serve` | |
| `remote-index` | |
| `mcp` | |

### Group 2 — Search & Discovery

Commands that answer "what is in the index right now?"

| Command | Notes |
|---|---|
| `search` | Vector similarity, supports hybrid BM25 |
| `first-seen` | Earliest occurrence of a concept |
| `dead-concepts` | Concepts that existed historically but not at HEAD |
| `impact` | Files coupled to a target file via vector similarity |

### Group 3 — File History

Commands that take a **file path** and trace its evolution over commits.

| Command | Notes |
|---|---|
| `evolution` | Full semantic drift timeline for a file |
| `diff` | Two-point semantic distance for a file |
| `semantic-blame` | Per-block attribution within a file |

### Group 4 — Concept History

Commands that take a **text query** and trace it across the entire codebase over time.

| Command | Notes |
|---|---|
| `concept-evolution` | Cross-codebase concept arc (query → timeline) |
| `first-seen` | Origin of a concept (also fits Group 2) |

> **Note:** `first-seen` is a natural "entrypoint" for concept history — it finds where the arc starts. It reasonably belongs in both Group 2 and Group 4.

### Group 5 — Cluster Analysis

Commands that cluster the full blob space by vector similarity.

| Command | Notes |
|---|---|
| `clusters` | Static snapshot of semantic regions |
| `cluster-diff` | Structural shift between two refs |
| `cluster-timeline` | Multi-step cluster drift over history |

---

## Naming recommendations

If command renames are acceptable in a future major version, the following would improve clarity:

| Current name | Suggested name | Reason |
|---|---|---|
| `evolution` | `file-evolution` | Mirrors `concept-evolution`; makes clear the input is a file path |
| `diff` | `file-diff` or `semantic-diff` | Disambiguates from `cluster-diff`; `diff` alone is too generic |
| `semantic-blame` | `blame` | Shorter, follows git conventions, the "semantic" qualifier is already implied by the tool |

The `cluster-*` prefix convention is already strong and should be retained.

---

## Alternative approaches under consideration

### A. Rename `cluster*` → `concept*`

**Proposal:** Rename the three clustering commands to use the `concept` prefix:

| Current | Proposed |
|---|---|
| `clusters` | `concepts` |
| `cluster-diff` | `concept-diff` |
| `cluster-timeline` | `concept-timeline` |

**In favour:** The K-means clusters *are* semantic concept regions — calling them "concepts" would align the vocabulary with `concept-evolution` and `dead-concepts`. A user thinking "I want to understand the concepts in this codebase" would naturally reach for `concepts`.

**Against:**
- `concept-diff` would sit next to `concept-evolution` and could be confused with "diff of how a concept evolved", which is not what it does. `concept-diff` is a structural snapshot comparison; `concept-evolution` traces a query over time.
- `concepts` (plural, no argument) is more ambiguous than `clusters` (which implies a clustering operation).
- Renaming all three commands is a larger breaking change than renaming one.

**Verdict:** Worth pursuing, but only if `concept-diff` / `concept-timeline` are distinguished clearly in descriptions. The naming works best if the three commands are always presented as a family, e.g., via CLI group headers.

---

### B. Unify `evolution` and `concept-evolution` under a single command with sub-arguments

**Proposal:** Replace two top-level commands with one command that routes on input type:

```
# File mode (current: gitsema evolution <path>)
gitsema evolution file <path>

# Concept mode (current: gitsema concept-evolution <query>)
gitsema evolution concept <query>

# Or with a flag:
gitsema evolution --file <path>
gitsema evolution --concept <query>
```

**In favour:**
- Removes the surface-level ambiguity — there is only one `evolution` entry in `--help`.
- Groups the two related ideas under a single verb, making it clearer they are variations of the same question ("how did X evolve?").
- Makes room for future variants (e.g., `evolution symbol`, `evolution module`) without cluttering the top-level command list.

**Against:**
- The two modes have very different required arguments, flags, and output shapes. Combining them into one command adds dispatch logic and makes `--help` output harder to read (users would see flags that only apply to one mode).
- Breaking change — all existing scripts using `concept-evolution` or `evolution` directly would need updating.
- Commander.js sub-commands are possible (`program.command('evolution').command('file')`) but add nesting depth.

**Alternative middle ground:** Keep both top-level commands but add a clear cross-reference in each description:

```
evolution <path>          Track semantic drift of a file (see also: concept-evolution)
concept-evolution <query> Trace a concept across the codebase (see also: evolution, first-seen)
```

**Verdict:** Sub-argument unification is architecturally clean but has a high migration cost. The cross-reference approach achieves most of the discoverability benefit at zero cost. If a v2 major-version break is planned, unifying under `evolution file` / `evolution concept` is recommended.

---

## Recommended next steps

1. **Add group headers to `gitsema --help`** using Commander.js's `addHelpGroup` API (available in Commander ≥ 12) or by prefixing command descriptions with a group tag (e.g., `[history] Track semantic drift of a file`).

2. **Update README** to list commands under the five group headings above rather than sequentially.

3. **Consider `file-evolution` rename** to remove the ambiguity with `concept-evolution`. This is the single highest-impact naming change.

4. **Cross-link related commands** in individual command help text, e.g., `evolution` should mention `diff` and `concept-evolution`.
