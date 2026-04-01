# SECTION2 — What's weak or underexplored

## 1. Function chunker is a regex heuristic

### Overview
Current function chunking is implemented with ad-hoc regular expressions that try to find function/method boundaries across languages. Regex chunking is fast and simple but brittle: it misses many language syntaxes (decorators, nested functions, non-C-style signatures), mis-splits minified/obfuscated code, and can't reliably provide parse-level structural context (AST nodes, function names, parameter lists, docstrings).

### Why it matters
Poor chunking reduces embedding quality for code semantics: embeddings may split logical units, mix unrelated code, or lose the function-level unit of intent. This degrades search precision for code-focused queries (e.g., "where is the HTTP retry logic?") and harms downstream features like semantic diff/evolution that rely on function-level alignment.

### Options to address
- Replace regex with tree-sitter based chunker: use tree-sitter to extract function/method node ranges per language. (High accuracy; cross-language).
- Hybrid approach: keep regex as fast fallback, but use language-aware parsers for known languages (TypeScript, Python, Go). (Good tradeoff for performance).
- Use heuristic-language-specific tokenizers (e.g., jscodeshift/AST for JS, lib2to3/parso for Python) for a curated list of high-value languages. (Lower integration effort).
- Chunk by semantic embeddings + boundary detection: compute sliding-window embeddings plus a boundary-detection model (learned or heuristics) to find semantic breaks. (Language-agnostic but costlier).

### Implementation notes
- Complexity: tree-sitter approach — Medium; hybrid — Low→Medium; learned boundary detection — High.
- Required components: tree-sitter grammars (npm/tree-sitter CI), integration layer in `src/core/chunking/`, language-to-parser mapping, additional npm deps (node-tree-sitter or wasm builds).
- Likely code areas: `src/core/chunking/*`, `indexer.ts`, `fileType.ts`, provider routing in `embedding/router.ts`.
- Blockers/deps: building tree-sitter parsers on Windows — use prebuilt WASM bundles or npm packages; licensing of some grammars (generally permissive).

### Risks and tradeoffs
- Tree-sitter increases dependency size and native build complexity on Windows; however prebuilt WASM mitigates this.
- More accurate chunking increases number of chunks → higher embedding calls/costs and DB rows.
- Hybrid fallback logic adds complexity to maintenance.

### Recommended priority
High — Function-level chunks are central to code search and evolution features; the accuracy gains yield large UX/precision improvements and unlock features like function-level drift.

### References / further reading
- Tree-sitter: https://tree-sitter.github.io/tree-sitter/
- Tree-sitter in JS: https://www.npmjs.com/package/tree-sitter
- Practical chunking discussion: "Code summarization and boundaries" (blog posts vary); see Tree-sitter use cases: https://tree-sitter.github.io/tree-sitter/using-parsers

---

## 2. Path relevance scoring is toy-grade

### Overview
Path scoring currently uses simplistic heuristics (e.g., substring matches, directory depth penalization). This produces brittle relevance signals: long paths, refactorings, or shallow matches can dominate scores despite poor semantic relevance.

### Why it matters
Path relevance is a useful orthogonal signal for developer intent (e.g., tests, docs, core modules). Weak path scoring means the three-signal ranking (vector + recency + path) underperforms: users lose quick wins such as prioritizing `src/auth/*` for auth-related queries or surfacing `README`/`docs` for conceptual queries.

### Options to address
- Improve textual path relevance with FTS/BM25 over path tokens: normalize paths (split on `/`, camelCase, kebab), index path tokens in FTS5 and compute BM25 scores.
- Learn-to-rank combining path + vector + recency: a small logistic/regression model (or pairwise ranking) trained on synthetic signals (e.g., repo heuristics) or user feedback.
- Path semantic expansion: map path tokens to embedding space (embed path string) and compute cosine similarity as an additional vector signal.
- Merge repository graph signals: use file-modularity (imports/exports) or call graph heuristics to boost paths connected to high-centrality modules.

### Implementation notes
- Complexity: FTS5 path BM25 — Low; embedding paths — Low→Medium; learn-to-rank — Medium; graph signals — High.
- Components: `blob_fts` or new FTS table for paths, ranking changes in `src/core/search/ranking.ts`, training/feature infra for learn-to-rank (could be offline).
- Code areas: `src/core/db/schema.ts`, `sqlite.ts` (FTS5 queries), `vectorSearch.ts`/`ranking.ts`, CLI flags for weights.
- Blockers/deps: need FTS5 present (already used); learn-to-rank requires labeled data or heuristics to bootstrap.

### Risks and tradeoffs
- Adding BM25/BINARY ranking increases SQL complexity but preserves determinism.
- Learned ranking improves personalization but requires data and maintenance; may overfit to repos in training set.
- Path embeddings may overweight short token matches; normalization is crucial.

### Recommended priority
Medium — Path scoring upgrades are high ROI (small code changes for BM25) and should be implemented after improving chunking; full learn-to-rank can be an iterative enhancement.

### References / further reading
- SQLite FTS5 & BM25: https://www.sqlite.org/fts5.html
- Learning to Rank overview: https://neo4j.com/blog/learn-to-rank/
- Tokenization for file-paths (practical notes): blog posts on path tokenization (e.g., splitting camelCase/kebab).

---

## 3. The evolution/drift features have no UX story

### Overview
The repo has evolution/drift analysis primitives (`evolution`, `concept-evolution`) but lacks a coherent UX/story that translates raw timelines and cosine distances into developer actions—e.g., "why should I care?", "what do I do next?", or "is this change a regression or refactor?".

### Why it matters
Without a UX framing, advanced signals (semantic drift, concept provenance) remain academic and underused. Developers need clear affordances: triage alerts, visual diffs, links to commits/prs, and suggested code owners. Poor UX reduces adoption and prevents these features from differentiating the product.

### Options to address
- Build CLI-first user journeys: add commands that surface actionable insights (e.g., `gitsema evolution --alerts` shows large semantic jumps with commit links and suggested reviewers).
- Integrate with Git metadata & annotations: show commit messages, PR links, author info, and diff snippets inline in evolution output.
- Add visual output (optional): generate simple HTML timelines (static files) or JSON for Git GUI plugins (GitLens-like) — keeps CLI-first but enables richer UX later.
- Interpret drift: classify changes as "refactor", "bug fix", or "behavioral change" using heuristics (e.g., large semantic change + small diff size = refactor?) or a lightweight classifier.

### Implementation notes
- Complexity: CLI workflow + commit links — Low; HTML timeline generator — Medium; classifier for change intent — Medium→High.
- Components: `src/core/search/evolution.ts`, CLI commands in `src/cli/commands/*`, MCP response formats, optional static HTML renderer and templates.
- Code areas: evolution logic already exists; extend output formatting, add `--alerts` flag and `--open` to produce files in `.gitsema/`.
- Blockers/deps: classification requires labeled examples; mapping commits → PRs may need Git hosting API (GitHub/GitLab) credentials for enhancement.

### Risks and tradeoffs
- Automatic interpretation of intent can be wrong—should be surfaced as suggestions, not facts.
- HTML/visual features increase surface area to maintain; keep them optional/exported artifacts.
- Pulling PR metadata requires tokens and privacy considerations.

### Recommended priority
High — UX improvements amplify the value of existing analysis code with modest engineering effort and directly increase product adoption.

### References / further reading
- GitLens inspiration: https://gitlens.amod.io/
- Visualizing code evolution (papers/blogs): "Code Scene" product ideas and blogs — https://codescene.io/
- Concept drift survey: "A survey on concept drift adaptation" (Gama et al.) — https://dl.acm.org/doi/10.1145/3241037

---

## 4. No test suite

### Overview
The repo currently has no automated tests—even though Vitest is installed. Missing unit/integration tests leave regressions undetected, slow down refactors, and make contributors cautious to change critical codepaths (indexer, db migrations, embedding providers).

### Why it matters
Tests are foundational for reliability in a tool that modifies DB schema, embeds blobs, and runs long-lived indexing jobs. Without tests, releases risk data corruption, migration failures, and subtle ranking regressions that are hard to diagnose across large codebases.

### Options to address
- Start with a focused unit test tranche: chunking, path tokenization, ranking math (cosine), and deduper logic using Vitest. Use in-memory fixtures or a small sample repo.
- Add integration tests that run the indexer against a tiny git repo (programmatically created) and assert DB state. Use Node's child_process to run git in temp dirs.
- Add CI matrix with caching: run tests on Node versions and Windows in GitHub Actions; include a smoke test for Ollama vs HTTP provider (mock).
- Add regression tests for migrations: run migrations against a sample DB and assert schema and FTS content.

### Implementation notes
- Complexity: initial unit tests — Low; integration + CI — Medium; full end-to-end with mock servers — Medium→High.
- Components: `vitest` test files under `test/` or `src/__tests__/`, test fixtures (tiny git repos in `test/fixtures/`), CI config (`.github/workflows/test.yml`).
- Code areas: all core modules: `src/core/*`, plus small test harnesses invoking `indexer.ts`.
- Blockers/deps: tests that call embedding APIs should be mocked to avoid network/cost—add a fake embedding provider implementing the provider interface.

### Risks and tradeoffs
- Tests add maintenance cost but reduce long-term risk dramatically.
- Integration tests that spawn git and SQLite are slower; keep fast unit tests first and run E2E less frequently.

### Recommended priority
High — Tests are critical technical debt; start small (unit tests) immediately and gate contributions with CI.

### References / further reading
- Vitest: https://vitest.dev/
- Testing git-based tools: blog posts on testing git workflows (e.g., creating repos in temp dirs)
- Mocking embeddings pattern: use a local fake provider or HTTP mock server (nock, msw).

---

## 5. Remote job registry leaks memory

### Overview
The remote job registry (used by `remoteIndexer` or MCP remote tasks) retains strong references to job objects or event listeners and does not garbage-collect completed/failed tasks, causing memory growth over long-running servers.

### Why it matters
Memory leakage leads to long-term process bloat, degraded performance, and eventual OOM crashes—especially harmful for central servers (MCP/serve) responsible for many indexing jobs. Windows environments with long uptime may show steady memory growth.

### Options to address
- Implement explicit lifecycle management: remove job entries and detach listeners on job completion/failure; add periodic cleanup sweep for stale jobs.
- Use weak references / FinalizationRegistry for metadata where appropriate, and keep only compact summaries for finished jobs (e.g., outcome + timestamps).
- Add job TTL and pruning policy persisted in DB: compact job registry to keep only last N results and purge older metadata.
- Add observability + diagnostics: heap snapshots on thresholds, per-job memory accounting to find hotspots.

### Implementation notes
- Complexity: explicit cleanup — Low; weak refs/FinalizationRegistry — Medium (browser/Node support nuances); TTL+DB pruning — Medium.
- Components: `remoteIndexer.ts`, MCP server code in `src/mcp/`, job registry module, metrics (prom-client) and health endpoints.
- Code areas: event emitter usage, `remoteIndexer` state machine, any global maps (`Map`/`Set`), worker thread pools.
- Blockers/deps: FinalizationRegistry is available in modern Node; on older Node versions, rely on manual cleanup. Windows-specific behavior is the same as other OSes for Node processes.

### Risks and tradeoffs
- Weak refs are non-deterministic; prefer deterministic cleanup for correctness.
- Aggressive pruning removes forensic data—persist summaries before pruning.
- Adding cleanup increases code complexity; must be well-tested (see test suite recommendation).

### Recommended priority
High — Memory leaks in long-running servers are operationally urgent and should be fixed quickly with deterministic cleanup and pruning.

### References / further reading
- Node.js memory leak guide: https://nodejs.org/en/docs/guides/debugging-memory-leaks/
- FinalizationRegistry MDN: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/FinalizationRegistry
- Patterns for job lifecycle management (blog resources) — e.g., background job queues and retention policies.

---

# SECTION3 — What you could do with these embeddings

## High value, tractable

### 1) Repo-wide "semantic blame" / nearest-neighbor git blame
- Short description  
  Augment `git blame` with semantic nearest-neighbor lookups: for a line or hunk produce the blob(s) historically most semantically similar (not just most recent author). Surface earlier code that introduced the concept even across renames.
- Why it's high value  
  Developers often need to find precedent code or origin of behavior that textual blame misses (refactors/renames). Useful in debugging, onboarding, and refactor justification.
- Implementation approaches  
  1. Query embeddings for the selected code snippet and return top-N nearest blob embeddings across history; correlate with commits and show commit + snippet. Pros: simple; low infra. Cons: requires chunk-level embeddings and decent chunker.  
  2. Precompute neighbor graph per blob (k-NN) stored in SQLite table for fast lookup. Pros: fast queries; scalable. Cons: precompute cost and storage.  
- Complexity estimate  
  Low→Medium (depends on precompute).
- Suggested first-step prototype  
  Add a CLI command `gitsema sblame <file>:<line>` that embeds the selected line (using text provider), does an on-the-fly vector search (top 10), and prints commit hashes + paths. Validate value with a few repos.

### 2) Semantic code search tuned for "why" queries (intent-first)
- Short description  
  Prioritize chunks that contain explanations, docstrings, comments, tests, or integration examples for an intent-based query (e.g., "how is access token refreshed?").
- Why it's high value  
  Developers ask "how" and "why" frequently; surfacing examples and docs reduces time-to-fix.
- Implementation approaches  
  1. Boost chunks with `file_type` or path signals (docs/tests) via ranking weights. Pros: quick to implement using existing FTS5 + path scoring.  
  2. Use a classifier to tag chunks as "explanatory" (comments/docstrings) and surface them for natural-language queries. Pros: better precision; requires a small model.  
- Complexity estimate  
  Low→Medium.
- Suggested first-step prototype  
  Implement a `--prefer-docs` flag that boosts `blob_fts` BM25 for `docs`/`README` and re-rank vector hits; measure click-through or local relevance.

### 3) First-seen / provenance alerts for security-sensitive code
- Short description  
  Automatic "first-seen" detection for security-related concepts (e.g., "eval", "deserialization", "authorization bypass") to flag when risky patterns appeared and who introduced them.
- Why it's high value  
  Security teams can triage risky changes across history and map regression windows; DevOps can prioritize code audit.
- Implementation approaches  
  1. Seed queries and run `first-seen` offline daily for watchlist terms; emit alerts when first-seen is recent. Pros: operationally simple.  
  2. Use semantic classifiers to detect risky patterns beyond keywords (embedding + classifier). Pros: fewer false negatives. Cons: needs training data.
- Complexity estimate  
  Low→Medium.
- Suggested first-step prototype  
  Build a cron that runs `gitsema first-seen "eval OR deserializ*" -k 1` and writes a brief report; evaluate signal/noise.

### 4) Evolution timeline CLI with actionable links
- Short description  
  Turn existing evolution output into an actionable CLI report (largest semantic jumps, suggested reviewers, commit links, one-line diff snippets).
- Why it's high value  
  Helps code owners and maintainers triage unusual changes quickly without manual history inspection.
- Implementation approaches  
  1. CLI-first structured output (JSON + optional HTML) that links commits and highlights large cosine deltas. Pros: fast to implement.  
  2. Integrate with code host APIs to open PRs/notify authors for flagged drifts. Pros: automated workflows; requires tokens.
- Complexity estimate  
  Low→Medium.
- Suggested first-step prototype  
  Add `gitsema evolution --alerts --format=json` that lists top 5 large-change versions with commit hashes and delta scores.

---

## Higher effort but differentiated

### 1) Temporal semantic index + temporal queries (time-aware vector index)
- Short description  
  Index vectors with temporal metadata and support time-windowed nearest-neighbor queries (e.g., "what did this concept look like in 2018?") and time-aware ranking.
- Why it's high value  
  Differentiates product by enabling historical forensics, regression hunting, and evolutionary analytics across large histories—useful for security, auditing, and research.
- Implementation approaches  
  1. Keep existing SQLite store but add a temporal k-NN index sharded by time buckets (e.g., per-year) and merge results at query time. Pros: simple to adopt. Cons: more query complexity.  
  2. Use a vector indexing engine that supports metadata filters (e.g., FAISS + metadata store, or HNSWlib + custom filter layer). Pros: faster for large corpora; cons: extra infra and cross-platform packaging.  
  3. Hybrid: use approximate indices for hot (recent) data and SQLite scans for cold/history. Pros: cost-performance balance.
- Complexity estimate  
  High.
- Suggested first-step prototype  
  Implement time-bucketed ANN using an open-source in-process index (hnswlib Node bindings or a WASM-compiled index) for a single repo and expose `--before/--after` support to measure query accuracy and performance.

### 2) Concept-evolution visualization + interactive exploration
- Short description  
  A small web/HTML app that visualizes semantic clusters over time, shows nearest neighbors, and lets users click to open relevant commit/diff — essentially a lightweight "semantic time-travel" UI.
- Why it's high value  
  Makes concept drift tangible to humans and becomes a product hook for code review, security audits, and historical education.
- Implementation approaches  
  1. Static HTML + JS artifacts generated by CLI (`gitsema evolution --dump --html`). Pros: easy to ship; no server.  
  2. Small server with React UI and MCP-backed queries for live exploration. Pros: interactive and extensible; cons: server infra and auth considerations.
- Complexity estimate  
  Medium→High.
- Suggested first-step prototype  
  Produce a single-file static HTML that loads a `concept_evolution.json` (from `--dump`) and renders an interactive timeline (use D3 or lightweight libs) to validate UX.

### 3) Hybrid ranking with learning-to-rank using click/feedback signals
- Short description  
  Combine vector, BM25 (FTS5), recency, and path signals in a small learn-to-rank model that is updated with user feedback or synthetic signals to maximize developer satisfaction.
- Why it's high value  
  A tuned ranker meaningfully improves result ordering and can be the product's "secret sauce" to beat naive vector-only tools.
- Implementation approaches  
  1. Offline logistic/regression model trained on synthetic labels (e.g., path heuristics, test files) and served as a scorer in ranking pipeline. Pros: deterministic, quick to iterate.  
  2. Online learning system collecting implicit feedback (clicks/opens) and updating model periodically. Pros: adapts to repo; cons: requires telemetry and privacy controls.
- Complexity estimate  
  High.
- Suggested first-step prototype  
  Implement an offline ranking combiner that learns weights on features (cosine, bm25, recency, path) using logistic regression on a small labeled dataset; replace hard-coded weights and measure NDCG on held-out queries.

### 4) Local modelserver & fallback strategies to reduce cost/latency
- Short description  
  Provide a packaged local modelserver (vector + optional reranker) and graceful fallbacks between Ollama, local modelserver, and remote HTTP provider.
- Why it's high value  
  Improves offline/air-gapped usability, reduces embedding latency/cost, and simplifies reproducibility for Windows devs using Ollama or local servers.
- Implementation approaches  
  1. Document & bundle a small Docker image for the existing Python modelserver; provide an easy `pnpm dev` config to use it. Pros: reproducible.  
  2. Implement a lightweight on-disk cache + local provider that returns cached embeddings for known blobs and falls back to remote. Pros: immediate cost savings, low infra.
- Complexity estimate  
  Medium.
- Suggested first-step prototype  
  Add a local embedding cache layer in the `EmbeddingProvider` chain that checks `.gitsema/embeddings-cache` (filesystem) before calling external providers; measure hit rate and cost savings.

### References / further reading (general)
- FAISS (approximate nearest neighbors): https://github.com/facebookresearch/faiss  
- hnswlib: https://github.com/nmslib/hnswlib  
- SQLite FTS5 docs: https://www.sqlite.org/fts5.html  
- Tree-sitter: https://tree-sitter.github.io/tree-sitter/  
- Vitest testing: https://vitest.dev/
