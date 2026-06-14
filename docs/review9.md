# Code Review 9 — LLM Layer, Pluggable Storage Backends, and Server-Side Persistence

This review reflects the repository state at **v0.94.0** (schema **v23**, **1040 passing / 22 skipped / 0 failing**, `pnpm build` clean), branch point `7b52757`. Scope per request: assess everything landed since [review8](review8.md) (v0.90.11 / schema v21) — i.e. Phases **95–104**. The three substantial new subsystems are:

- **The LLM layer** (Phases 96–99, 104): `narrate` / `explain` / `guide`, the chattydeer + CLI-agent + Ollama backends, the `GUIDE_TOOLS` registry, and the `interpretations.ts` single-source-of-truth.
- **Pluggable storage backends** (Phases 101–103): the `MetadataStore` / `VectorStore` / `FtsStore` async seam with SQLite, Postgres+pgvector, and Qdrant adapters, plus `gitsema storage migrate`.
- **Persistent server-side repo storage** (Phase 100): `GITSEMA_DATA_DIR`-backed clones + per-repo index DBs, the repo registry, and `repoSession` middleware.

All high-severity findings below were **verified against the source at the cited file:line**, and the full suite was built and run (`pnpm install --frozen-lockfile && pnpm build && pnpm test`). One inherited claim was checked and **rejected** (see §7).

---

## 1) Executive assessment

The review8 debt is genuinely cleared: CI is green, the README is restored, the six unreachable commands are wired, the `--out` flag unification landed, and the half-finished `src/core/search/` reorg is finished (no barrel `index.ts`, no `core/` shim directory, no duplicate `booleanSearch.ts`, single lockfile, no stray `index.js`/`tmp/`/`*.log` at the root). That is real, measurable progress.

The new work is ambitious and mostly well-structured — the storage seam interfaces are clean in shape, the LLM layer is safe-by-default (no network without an explicit `--narrate` and a configured model — verified), and `PLAN.md` documents every deviation honestly. But three things stand out and should gate the next iteration:

1. **A remotely-reachable command injection** in the narrator's git-log path (`§2`). This is the most serious finding in any review so far: a string from the HTTP request body reaches `execSync(parts.join(' '))` unquoted.
2. **The new backends silently disagree with the old one.** `gitsema index --file` writes only SQLite regardless of `storage.backend`; Postgres/Qdrant `VectorStore`s silently ignore `allowedHashes`/`useVss`/`earlyCut`/caching; module embeddings are skipped without a warning (`§4`). Each is a "looks like it worked, returned wrong/empty results" failure mode.
3. **The canonical docs never caught up with the single biggest feature.** The entire Phases 101–103 storage system is absent from `CLAUDE.md` — no `storage.*` config keys, no `GITSEMA_STORAGE_*` env vars, no `storage migrate` / `setup` / `repos list-persisted` commands — and `features.md`'s header is stale (`v0.93.0 / schema v22 / 921 tests`) (`§5`).

Priority order: fix the injection (`§2`) → close the redaction gap (`§3`) → make the new backends fail loudly instead of silently (`§4`) → restore docs parity (`§5`) → de-duplicate the re-rank/provider/narrate code (`§6`).

---

## 2) Remote command injection in the narrator git-log path (CRITICAL — security)

`fetchCommitEvents()` builds a `git log` argument list and runs it through a shell:

- `src/core/narrator/narrator.ts:43` — `if (range) { parts.push(range) }` pushes the caller's `range` string **unquoted**.
- `src/core/narrator/narrator.ts:51` — `raw = execSync(parts.join(' '), …)` joins and runs the whole thing in a shell.
- The `since`/`until` branch wraps values in double quotes (`--since="${since}"`), but double quotes do **not** stop `$(…)` or backtick command substitution — so those two are injectable as well.

This is **reachable from the network**, not just the CLI:

- `src/server/routes/narrator.ts:23-32` — `NarrateBodySchema` accepts `since`, `until`, and `range` as free `z.string().optional()` fields.
- `src/server/routes/narrator.ts:61-68` — those fields are passed straight into `runNarrate(provider, { since, until, range, … })`, which calls `fetchCommitEvents`.
- Evidence-gathering runs **before** the LLM gate, so this fires even in safe-by-default / evidence-only mode and even when no narrator model is configured.

A request like `{"range":"HEAD; touch /tmp/pwned"}` to `POST /api/v1/narrate` executes arbitrary commands on the server with the server's privileges. It is gated only by the HTTP auth token. `gitsema explain` shares the `since`/`until` path.

**Fix:** replace `execSync(string)` with `execFileSync('git', ['log', …args])` (array form, no shell) — the same pattern already used correctly in `src/core/narrator/cliProvider.ts:103`. Validate `range` against an allowlist (refs / `A..B` / `A...B`) before use. This single change closes the CLI and HTTP vectors at once.

---

## 3) Redaction is applied inconsistently across the LLM layer (HIGH — security)

The layer has two redaction disciplines that disagree:

- **Redacted (correct):** the provider classes (`chattydeerProvider.ts:90-91`, `cliProvider.ts:50-51`), the `runNarrate`/`runExplain` paths (`narrator.ts:222,313` via `redactAll`), and the Phase-104 generic `narrateToolResult` (`src/core/llm/narrator.ts:518`, `redactAll([json])`).
- **Not redacted:** the **11 bespoke result-narrators** in `src/core/llm/narrator.ts` — `narrateEvolution` (119), `narrateClusters` (157), `narrateSecurityFindings` (184), `narrateSearchResults` (216), `narrateClusterDiff` (244), `narrateClusterTimeline` (282), `narrateChangePoints` (318), `narrateFileChangePoints` (348), `narrateDiff` (378), `narrateHealthTimeline` (419), `narrateLifecycle` (452). Each builds a prompt embedding file paths, code-adjacent text, cluster labels, and security-pattern matches, then calls `callLlm(...)` directly. `callLlm` (`src/core/llm/narrator.ts`) does **not** redact — it just POSTs the prompt to the external endpoint.

So the moment any of these eleven `--narrate` paths fire against an external model, content that the rest of the system carefully redacts is sent in the clear. The safe-by-default *network gate* still holds (these only run with `--narrate` + a configured model), but the *redaction* guarantee does not. `narrateSecurityFindings` and `narrateDiff` are the most sensitive.

**Fix:** route the eleven through `narrateToolResult` (they each already have a `TOOL_INTERPRETATIONS` entry), or at minimum wrap their prompts in `redactAll(...)` before `callLlm`. Add a test asserting every `callLlm` caller in `llm/narrator.ts` redacts first — this is the kind of guarantee that should be enforced mechanically, not by convention.

---

## 4) The new backends fail silently instead of loudly (HIGH — correctness)

Phases 101–103 made the backend swappable but left several paths that *appear* to honor `storage.backend` and don't. Each returns wrong-or-empty results with no error:

1. **`gitsema index --file` ignores the backend entirely.** `indexFileCommand` (`src/cli/commands/index.ts`, ~`:117/145/163`) calls the synchronous SQLite-only `storeBlob`/`storeBlobRecord`/`storeChunk` directly, never `profile.writeFileBlob`. On a Postgres/Qdrant profile, `index --file` silently writes to a local `.gitsema/index.db` that the configured backend never reads. *(PLAN.md §103 lists this as a follow-up, but a user has no way to know.)*
2. **`allowedHashes` / `useVss` / `earlyCut` / result-caching are silently dropped on Postgres/Qdrant.** `vectorSearch` dispatches to `profile.vectors.search(options)` (`src/core/search/analysis/vectorSearch.ts`), but `PgVectorStore.search` and `QdrantVectorStore.search` never read those keys. `allowedHashes` is the candidate filter behind boolean queries, negative examples, and branch scoping — dropping it returns **unfiltered** results that look plausible. This must throw (or warn) on unsupported, non-default options rather than ignore them.
3. **Module (directory-centroid) embeddings are skipped without a warning.** `indexer.ts` gates them behind `moduleEmbeddingsSupported = profile.backend === 'sqlite'` (~`:266`) and just no-ops on other backends. `--group module` / module search quietly returns nothing. Emit a one-line `logger.warn` at index time.
4. **Cross-store writes are non-atomic on Qdrant.** `src/core/storage/qdrant/profile.ts` commits Postgres metadata before the Qdrant upsert; a crash in between leaves an orphan blob row until the next incremental `index` self-heals it. Acceptable as designed, but the window should be documented and ideally surfaced by `doctor`.

**Fix:** rewire `indexFileCommand` through `profile.writeFileBlob`; make Postgres/Qdrant `VectorStore.search` throw a clear "option X not supported on backend Y" for non-default unsupported options; `logger.warn` when module embeddings are skipped.

---

## 5) Documentation never caught up with the new subsystems (HIGH — docs parity)

The canonical docs (CLAUDE.md, features.md) are the contract per `CLAUDE.md`'s own policy. They lag the biggest feature set badly:

1. **The entire pluggable-storage system is missing from `CLAUDE.md`.** Zero occurrences of `storage.` in the config section, despite `src/core/config/configManager.ts` supporting `storage.backend`, `storage.scope`, `storage.name`, `storage.metadata.url`, `storage.vectors.url`, `storage.vectors.apiKey`, `storage.fts.backend`, `storage.fts.url`. The `GITSEMA_STORAGE_*` env mappings are likewise undocumented in the env-var table. *(High)*
2. **New commands are undocumented in `CLAUDE.md`'s command reference:** `gitsema storage migrate`, `gitsema setup` (the Phase-104 alias of `quickstart`), `gitsema repos list-persisted`, `gitsema repos remove`, and the new `models add --provider ollama|cli` / no-arg Ollama discovery. *(High)*
3. **`features.md` header is stale.** `docs/features.md:3` reads `Current version: v0.93.0 · Schema: v22 · Test suite: 921 tests`; actual is **v0.94.0 / schema v23 / 1040 passing**. Same staleness class flagged in review8 §5.2 — the header keeps drifting. *(Medium)*
4. **`CLAUDE.md`'s env-var table is missing the operational family** beyond storage: `GITSEMA_DATA_DIR` is described in prose but not the table, and the `GITSEMA_CLONE_*`, `GITSEMA_JOB_*`, `GITSEMA_LLM_TIMEOUT`/`GITSEMA_LLM_RETRIES`, rate-limit, and body-size vars are absent. *(Medium)*

**Fix:** add a "Storage backends" subsection to CLAUDE.md (config keys + env vars + the three commands), regenerate the `features.md` header, and consider a tiny test that asserts the `features.md` banner matches `package.json`/`CURRENT_SCHEMA_VERSION` so it can't silently rot again.

---

## 6) Reusable code not extracted (the new subsystems)

review8 §4/§7 showed the team knows how to factor shared helpers; the new code hasn't had that pass yet.

1. **Postgres and Qdrant `VectorStore`s copy the entire re-rank.** The three-signal scoring loop (`pathRelevanceScore` + `computeRecencyScores` + weighted combine) and the `getFirstSeenMap`/`getLastSeenMap`/`getPaths` companions are near-identical between `src/core/storage/postgres/vectorStore.ts` and `src/core/storage/qdrant/vectorStore.ts` (Qdrant even reuses the *Postgres* metadata store as its relational companion). Extract a shared `rerankCandidates(...)` (and the companion joins) so the weighting formula lives in one place. *(Medium)*
2. **Duplicated `disabledResponse()` + redaction prologue across providers.** `chattydeerProvider.ts:51-58,90-92` and `cliProvider.ts:29-36,50-52` define an identical disabled-mode response and the same `redact(user)+redact(system)+merge firedPatterns` block. Hoist both into the shared narrator module. *(Medium)*
3. **The generic `narrateToolResult` didn't absorb the bespoke narrators.** Phase 104 added the generic path but left all 11 bespoke `narrate*` functions in place (this is the structural cause of the §3 redaction gap, not just a tidiness issue). Collapse them. *(Medium — pairs with §3)*
4. **`MAX_RESULT_CHARS` (`guideTools.ts:74`) and `NARRATE_RESULT_MAX_CHARS` (`llm/narrator.ts:487`)** are two copies of the same `4000` cap. One constant. *(Low)*

---

## 7) Correctness & robustness (mixed severity)

1. **`multiRepoSearch` is both leaky and wrong (HIGH).** `src/core/indexing/repoRegistry.ts:101` does `const session = openDatabaseAt(repo.dbPath)` inside the per-repo loop. `openDatabaseAt` (`src/core/db/sqlite.ts:437`) opens a fresh `better-sqlite3` connection every call and **never closes it** (no cache, no `close`) — a file-descriptor/WAL leak on a long-running server. Worse, the opened session is discarded: the next line calls `await vectorSearch(queryEmbedding, { topK, model })` **without** passing it, so `vectorSearch` runs against the *active* (cwd) session and returns the same results re-tagged with each `repoId`. The inline comment ("we pass the session directly via the rawDb approach") describes behavior the code doesn't implement. Wrap the body in `withDbSession(openDatabaseAt(...))` (and close after), or route through `getOrOpenSessionAtPath` + `withDbSession`. *(Pre-dates these phases but is live in the multi-repo path.)*
2. **Backend connections aren't validated on creation (Medium).** `getPgPool` (`src/core/storage/postgres/connection.ts`) and `getQdrantClient` (`src/core/storage/qdrant/connection.ts`) construct the pool/client without a probe, so a typo'd URL surfaces as an opaque error at first query rather than at `resolveStorageProfile()` time. A `SELECT 1` / health-check on first use (cached) gives a far better message — especially for the Phase-104 `setup` wizard, which is supposed to validate before writing config.
3. **Result-cache key omits the backend (Medium).** The cache key in `vectorSearch` is built from the query fingerprint + options, not `profile.backend`/`location`. Switching `storage.backend` without clearing the cache can serve results computed against the other store. Fold the backend identity into the key (or clear on profile change).
4. **`withRepoLock` is in-memory only (Low).** `repoRegistry.ts:262` serializes concurrent clone/index per `repoId` via a process-local `Map` — correct for a single server process, but two processes (or a restart mid-op) can still race on the same clone dir. Fine for now; a filesystem lock file would harden the multi-process story. SSH-agent forwarding (`cloneRepo.ts`) and token scoping (403/404/409 in `remote.ts` + `repoSession.ts`, tokens hashed with `timingSafeEqual`) were reviewed and look sound.

---

## 8) Architecture notes

- **The storage seam interfaces are clean, but the dispatch is inverted.** `vectorSearch`/`hybridSearch`/`searchCommits` each begin with `const profile = getCachedStorageProfile(); if (profile.backend !== 'sqlite') return profile.vectors.search(...)`, and for SQLite the free function *is* the implementation that `SqliteVectorStore.search` delegates back into. This was a deliberate trade (avoids editing ~30 call sites) and is recursion-safe today only because of the explicit `!== 'sqlite'` short-circuit. It's a latent foot-gun: a future refactor that makes `SqliteVectorStore.search` do real work, or removes the short-circuit, reintroduces infinite recursion. At minimum, add a prominent comment at each of the three functions documenting the contract ("SqliteVectorStore must delegate here and must not be re-entered"). Better: push the dispatch to a thin entry layer so the SQLite body isn't simultaneously "the function" and "the adapter target".
- **`interpretations.ts` as single source of truth is a genuinely good pattern** — one registry feeds the guide system prompt, the narrator personas, and the generated skill, with `docsSync` enforcing drift. Keep it; consider also asserting at module-init that every `GUIDE_TOOLS` key resolves to an interpretation (today only the test enforces it).
- **`storage migrate` is sqlite-source-only and `doctor` is asymmetric** (deep checks for SQLite, row-counts for Postgres/Qdrant). Both are documented follow-ups in PLAN.md §103; fine to defer, but they're the kind of gap that bites during an actual production migration.

---

## 9) What is working well (verified, keep doing this)

1. **review8 is genuinely closed out:** green CI, restored README, all previously-unreachable commands wired, `--out` unified, `src/core/search/` reorg finished, repo root cleaned.
2. **LLM layer is safe-by-default** — confirmed no network call without `--narrate`/configured model; CLI adapters spawn via `execFile` (no shell), so the agent-CLI path is *not* injectable (unlike §2's git path); provider classes and the generic narrator redact.
3. **Storage deviations are documented honestly** in PLAN.md §§101–103, with conformance tests (SQLite + env-gated Postgres/Qdrant suites).
4. **Server auth is solid:** hashed repo tokens, `timingSafeEqual`, correct 403/404/409 scoping in the remote-index and repoSession paths.
5. **Test suite grew with the features** — 1040 passing, build clean.

**Inherited claim checked and rejected:** an audit pass flagged CLAUDE.md's "MCP server exposes 34 tools" as wrong ("actually 32"). It is **correct** — `src/mcp/tools/narrator.ts` registers its 2 tools via `server.tool(...)` (not `server.registerTool(...)`), so 32 + 2 = 34. No change needed there.

---

## 10) Concrete improvement points (priority order)

1. **Fix the command injection (§2):** switch `fetchCommitEvents` to `execFileSync('git', [...])` and allowlist `range`. Add a regression test posting a malicious `range` to `/api/v1/narrate`. *(Critical)*
2. **Close the redaction gap (§3):** route the 11 bespoke `narrate*` through `narrateToolResult`/`redactAll`; add a test that every `callLlm` caller redacts. *(High)*
3. **Make new backends fail loudly (§4):** rewire `index --file` through `profile.writeFileBlob`; throw on unsupported non-default `VectorStore.search` options; warn when module embeddings are skipped. *(High)*
4. **Restore docs parity (§5):** document `storage.*` keys, `GITSEMA_STORAGE_*`/`GITSEMA_DATA_DIR`, and `storage migrate`/`setup`/`repos list-persisted` in CLAUDE.md; refresh the `features.md` header; add a banner-vs-package.json test. *(High)*
5. **Fix `multiRepoSearch` (§7.1):** activate and close the per-repo session via `withDbSession`; it currently leaks connections and queries the wrong DB. *(High)*
6. **De-duplicate (§6):** shared `rerankCandidates` + companion joins for Postgres/Qdrant; shared `disabledResponse`/redaction prologue; collapse bespoke narrators; one result-cap constant. *(Medium)*
7. **Harden backend startup (§7.2–7.3):** validate Postgres/Qdrant connections on first use; fold backend identity into the result-cache key. *(Medium)*
8. **Document the dispatch contract / consider a thin entry layer (§8)** to remove the recursion foot-gun. *(Medium)*
9. **Centralize `--narrate`** behind a shared `addNarrateOption(cmd)` helper so the per-command wiring stops being ad-hoc. *(Low)*

---

*Methodology: three parallel audits (storage seam; LLM narrator/guide layer; server persistence + docs parity), then manual source verification of every Critical/High claim at the cited file:line — including the two injection/redaction findings and the multiRepoSearch leak — plus a fresh `pnpm install --frozen-lockfile && pnpm build && pnpm test` (1040 passed / 22 skipped, build exit 0). One inherited "tool count" claim was traced to `server.tool` vs `server.registerTool` and rejected. review8 follow-through (CLI wiring, search reorg, root hygiene, flag unification) was spot-checked and confirmed resolved.*
