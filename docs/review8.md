# Code Review 8 — CLI Wiring, Usability, Code Reuse, and Directory Structure

This review reflects the repository state at **v0.90.11** (schema **v21**, **758/759 tests passing — 1 failing**), branch point `0b0277c`. Scope per request: are all features correctly wired up and presented in the CLI, is the presentation useful and aligned with user expectations, is reusable code extracted where necessary, and is the directory structure coherent.

All high-severity findings below were **verified at runtime** against a fresh build (`pnpm build` + `node dist/cli/index.js …`), not just by reading code.

---

## 1) Executive assessment

The CLI's *presentation layer* is in good shape: grouped `--help` output, consistent 1–2 sentence descriptions with cross-references, `--out` output sinks, and hidden deprecation aliases are all genuinely good UX. The *wiring underneath it* is not: a half-finished registration refactor has silently dropped **six documented commands** from the binary, the test suite is currently **red** (`docsSync`), and the README — designated the canonical user-facing command reference — is a 9-line stub. In the core, a search-module reorganization was left half-done (shim layers, one byte-identical duplicate file, a barrel export that violates the repo's own convention), and the CLI command handlers carry ~500 lines of copy-pasted boilerplate that has **already drifted** between copies.

Priority order: fix the unreachable commands (§2) → restore README/docs parity so CI is green (§5) → extract the CLI boilerplate (§4) → finish or revert the search-module reorg and clean the repo root (§6).

---

## 2) Broken wiring: six documented commands are unreachable (CRITICAL)

The following commands are documented (CLAUDE.md / `docs/features.md`), listed in `COMMAND_GROUPS` in `src/cli/index.ts`, have live handler implementations, and have MCP equivalents — but are **not registered with Commander**, so invoking them prints the generic root help and exits 0:

| Command | Handler (orphaned) | Documented in |
|---|---|---|
| `first-seen <query>` | `src/cli/commands/firstSeen.ts:57` | CLAUDE.md CLI reference, features.md |
| `file-evolution <path>` | `src/cli/commands/evolution.ts` | CLAUDE.md CLI reference, features.md |
| `pr-report` | `src/cli/commands/prReport.ts` | features.md, `COMMAND_GROUPS` |
| `triage <query>` | `src/cli/commands/triage.ts` | features.md, MCP `triage` tool |
| `policy check` | `src/cli/commands/policyCheck.ts` | features.md, MCP `policy_check` tool |
| `ownership <query>` | `src/cli/commands/ownership.ts` | features.md, MCP `ownership` tool |

**Verified:** `node dist/cli/index.js triage --help` (and the other five) print the root usage banner instead of command help or an "unknown command" error — a silent failure mode that makes the breakage easy to miss.

### Root cause

The registration refactor that split `src/cli/index.ts` into `src/cli/register/{all,setup,indexing,search,analysis}.ts` was left half-finished:

1. `registerAll()` (`src/cli/register/all.ts:54-57`) calls `registerSetup`, `registerIndexing`, `registerSearch` — but **never calls `registerAnalysis`**, despite importing it at `all.ts:8`. Commit `6a328f4` ("avoid double-registering analysis commands in registerAll") fixed a duplicate-registration error by removing the *call* instead of removing the *duplicate definitions*.
2. As a result, `src/cli/register/analysis.ts` (127 lines) is **dead code**, and the four commands defined *only* there (`pr-report`, `triage`, `policy check`, `ownership`) are unreachable.
3. The other six commands in `analysis.ts` (`eval`, `repl`, `quickstart`, `regression-gate`, `cross-repo-similarity`, `code-review`) are defined **twice** — once in dead `analysis.ts:63-126` and once in live `all.ts:499-563`. Two definitions of the same command in two files is a drift bomb: whichever one a future contributor edits has a 50% chance of being the dead one.
4. `first-seen` and `file-evolution` were lost separately: their registrations were deleted along with the 1,111-line removal of old inline registrations in `src/cli/index.ts` and never re-added in any `register/` module.
5. The comment at `all.ts:147` ("Many analysis commands are already registered by registerAnalysis; avoid duplicates") is **false** and actively misleading — it documents the inverse of reality.

### Fix

- Delete the six duplicate registrations from `all.ts:499-563`; make `analysis.ts` the single source for analysis commands; call `registerAnalysis(program)` in `registerAll`.
- Re-register `first-seen` and `file-evolution` (their handlers are intact) — `register/search.ts` and a file-history group are the natural homes.
- Consider renaming `policy check` → `policy-check` while re-wiring: it is the only two-word command and breaks the kebab-case convention used by every other multi-word command.
- Add a regression test that walks `COMMAND_GROUPS` and asserts every key resolves to a registered (or intentionally hidden) Commander command. `COMMAND_GROUPS` currently lists all six broken commands, so it is already a machine-readable manifest of intent — it just isn't checked.

---

## 3) CLI presentation & usability

### Positives (keep these)

- Grouped `--help` via custom `formatHelp` (`src/cli/index.ts:121-199`) with 14 thematic groups is the right answer to a ~50-command surface.
- Descriptions are consistently styled and include `(see also: …)` cross-references; several commands add worked examples via `addHelpText` (e.g. `experts`, `all.ts:485`).
- Deprecated aliases (`mcp`, `serve`, `lsp`, `backfill-fts`, …) are correctly hidden and funneled to `gitsema tools …` / `gitsema index …` subcommands.
- `--out <spec>` (repeatable, `text|json[:file]|html[:file]|markdown[:file]`) is a good unified output design.

### Issues

1. **`workflow` shows with an empty description** in `--help` (the "Workflows:" group contains a single bare word). The parent command created in commit `d7a07f9` lacks `.description()`. One line to fix; as-is it looks broken to users. *(Medium)*
2. **Output-flag migration is half-done.** `--out` coexists with legacy `--dump [file]`, `--html [file]`, and a third style `--format text|json` (`regression-gate`, `cross-repo-similarity`, `code-review`, `ci-diff`, `workflow run`). Some commands have all three vocabularies; some have only the legacy ones (`experts` has `--dump`/`--html` but no `--out`, `all.ts:492-493`). Users cannot predict which spelling a given command accepts. Standardize on `--out`, keep legacy flags as hidden deprecated aliases, and add a consistency test. *(High)*
3. **Top-k flag inconsistency.** Most commands use `-k, --top <n>`; several use `--top` with no short form (`experts`, `regression-gate`, `cross-repo-similarity`, `code-review`); `project` uses `--limit`. Defaults vary (5/10/50) without the help text explaining why. *(Medium)*
4. **Date-filter vocabulary varies**: `search` uses `--before`/`--after` (YYYY-MM-DD), `experts`/`change-points` use `--since`/`--until` (dates or ISO 8601), `index start --since` accepts dates *or git refs*. Pick `--since`/`--until` as canonical, document accepted formats centrally, alias the rest. *(Medium)*
5. **Exit codes are uniformly `process.exit(1)`** for everything from bad arguments to provider-down to CI-gate failure. CI-oriented commands (`ci-diff`, `regression-gate`, `policy check`, `code-review`) especially need distinct codes (e.g. 1 = runtime error, 2 = usage error, 3 = gate failed) so pipelines can distinguish "drift detected" from "Ollama was down". *(High for the CI commands)*
6. **Error messages are inconsistently actionable.** Good: `diff` and `bundleIndex` say "Run `gitsema index` first" (`src/cli/commands/bundleIndex.ts:41`). Bad: provider failures surface as bare "Is the embedding provider running?" (`author.ts:76`) with no mention of `gitsema doctor`, `gitsema quickstart`, or the active `GITSEMA_PROVIDER`/URL. There is no shared "index missing", "index empty", or "provider unreachable" message — each of ~30 commands hand-rolls its own. *(High — see §4, this is the same extraction)*
7. **`--verbose` is accepted globally but rarely honored.** `index.ts:13` sets `GITSEMA_VERBOSE=1`, the logger picks it up, but almost no command handler emits debug-level decisions (cache hit/miss, ANN vs linear scan, provider/model resolution). Users who pass `--verbose` mostly get identical output. *(Medium)*
8. **No progress indication** for long operations (clustering, large searches, eval runs). Indexing has progress in core; analysis commands sit silent for many seconds. A minimal elapsed/spinner wrapper for operations >2s would help. *(Low/Medium)*
9. **Threshold flags don't state their scale.** `--threshold` means cosine *distance* in some commands (0–2), *similarity* in others (0–1), with defaults 0.15/0.3/0.7/0.75 and ranges often undocumented in help text. State the scale and range in every threshold's help string. *(Medium)*

---

## 4) Reusable code not extracted (CLI layer)

The core layer is largely clean (see §7), but `src/cli/commands/` carries heavy copy-paste:

1. **`buildProviderOrExit()` is privately defined in 14 command files** (`author.ts`, `search.ts`, `impact.ts`, `changePoints.ts`, `semanticBisect.ts`, `semanticBlame.ts`, `semanticDiff.ts`, `serve.ts`, `cherryPickSuggest.ts`, `conceptEvolution.ts`, `conceptLifecycle.ts`, `ciDiff.ts`, `policyCheck.ts`, `index.ts`). **The copies have already diverged** — `author.ts` and `impact.ts` versions hash differently — which is precisely the failure mode this repo's own §11.4 refactor (`utils/embedding.ts`) was written to prevent. *(Critical)*
2. **Model-override + env-fallback boilerplate in 19 files**: `applyModelOverrides({...})` followed by `process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'` chains. *(High)*
3. **JSON/sink output epilogue repeated in ~35 commands**: `resolveOutputs` → `getSink(sinks,'json')` → `JSON.stringify` → `writeToSink` → "return early unless text/html sink" — a ~10-line pattern per command. *(High)*
4. **`quickstart` reimplements provider detection** (hand-rolled `fetch('http://localhost:11434/api/tags')` with AbortController, `quickstart.ts:57-80`) instead of sharing detection logic with `doctor`/provider factory. *(Medium)*

**Fix:** create `src/cli/lib/` (or `src/cli/shared/`) with `provider.ts` (`buildProviderOrExit`, `resolveModels`, provider reachability probe shared by quickstart/doctor), `output.ts` (the sink epilogue as one helper), and `errors.ts` (`ensureIndexExists()`, `providerUnreachableHint()` with consistent, actionable messages). Estimated ~500 duplicated lines collapse to ~100, and §3.6's message consistency falls out for free.

Counter-balance — already done well: `utils/outputSink.ts` is imported by 40+ commands, `utils/parse.ts` by 10, `renderResults` is shared from `ranking.js`. The discipline exists; it just wasn't applied to provider construction and the JSON epilogue.

---

## 5) Documentation ↔ interface parity (and a red test suite)

1. **The test suite currently fails.** `tests/docsSync.test.ts:84` allows ≤5 commands missing from README; **31 are missing** because commit `281244a` ("Strip README of old info") reduced README.md to 9 lines. Verified: `vitest run tests/docsSync.test.ts` → 1 failed. Either the README strip was intentional (then the canonical-docs policy in CLAUDE.md and the test must change to point at `docs/features.md`) or it wasn't (then the command-reference tables must be restored). As it stands, CLAUDE.md's instruction "update the command/option tables in README.md" refers to tables that no longer exist, and CI on this tree is red. *(High)*
2. **`docs/features.md` header is ~20 minor versions stale**: claims **v0.70.0 / schema v17 / ~364 tests** against actual **v0.90.11 / schema v21** (`docs/features.md:3`). The catalog content below the header is more current than its own banner, which undermines trust in the whole document. *(High)*
3. **CLAUDE.md says the MCP server exposes "24 tools"; the code registers 32** (`registerTool` calls across `src/mcp/tools/{search:5, analysis:20, clustering:3, infrastructure:1, workflow:3}.ts`). Missing from the documented table include `doc_gap`, `contributor_profile`, `ownership`, `triage`, `policy_check`, `workflow_run`, `eval`. *(Medium)*
4. **Config keys drift**: `configManager.ts:42-109` supports `llmModel`, `remoteKey`, `index.maxCommits`, `index.windowSize`, `index.overlap`, `search.recent`, `search.weight*` — none documented in CLAUDE.md's configuration section. *(Medium)*
5. **HTTP API docs**: `POST /api/v1/analysis/experts` is registered (`src/server/app.ts`) but absent from features.md's route list (`docs/features.md:213-254`). *(Low)*
6. Spot-check of 10 documented flag defaults (search/index/clusters/MCP) found **no mismatches** — defaults are trustworthy. *(Pass)*

---

## 6) Directory structure coherence

### `src/core/search/` — a three-layer half-finished reorg (High)

Real implementations live in `analysis/` (vector/hybrid/boolean/resultCache), `temporal/` (evolution, changePoints, healthTimeline, timeSearch), and `clustering/`. On top of that:

- **Ten top-level 1-line shims** (`vectorSearch.ts`, `evolution.ts`, `clustering.ts`, …) re-export the subdirectory files; tests and some modules still import through them.
- **A `core/` subdirectory of five more shims** pointing at `../analysis/` — except **`core/booleanSearch.ts`, which is a byte-identical 35-line *copy* of `analysis/booleanSearch.ts`**, not a shim. This is exactly the dual-copy drift risk that the comment in `core/vectorSearch.ts` says the shims were created to eliminate. *(High — convert to shim or delete)*
- **`src/core/search/index.ts` is a barrel export**, in direct violation of the repo's "No barrel exports" convention (CLAUDE.md, Development conventions). Its own comment ("Add more re-exports here as you finalize the grouping") confirms the reorg was never finalized. *(Medium)*
- The top-level shim `resultCache.ts` retains a 13-line doc comment describing the *old* implementation above its one-line re-export. *(Low)*
- Meanwhile ~25 search modules (`mergeAudit.ts`, `semanticDiff.ts`, `debtScoring.ts`, `experts.ts`, `cherryPick.ts`, …) remain ungrouped at the top level, so the directory simultaneously exhibits three organizational schemes.

**Recommendation:** finish the migration in one pass — update all imports (including tests) to canonical subdirectory paths, delete all shims, the `core/` shim directory, and the barrel; either move the remaining ~25 files into the group folders or accept a flat layout and remove the folders. Half-and-half is the worst of both.

### Repo root hygiene (Medium)

Committed at the repo root: **three lockfiles** (`pnpm-lock.yaml` — the real one per CI, plus stale `package-lock.json` and `yarn.lock`), a vestigial 3-line `index.js` (entry point is `dist/cli/index.js`), a runtime log (`index.log`), **`tmp/search-backups/`** containing manual pre-refactor copies of five search files (git already remembers; these invite confusion with §6's shim mess), `plan3.md`, and `ISSUE_BODY_search_after.md`. Delete the stale lockfiles, log, `index.js`, and `tmp/`; move or close out the ad-hoc notes; add `tmp/` and `*.log` to `.gitignore`. `src/core/phase41plus.ts` is a 9-line never-imported documentation stub — fold its sentence into `docs/PLAN.md` and delete.

### Structure that is fine as-is

`src/cli/` vs `src/core/` vs `src/mcp/` vs `src/server/` separation is clean and honors the "MCP is a thin adapter" constraint; `src/core/viz/htmlRenderer-*.ts` is well-factored with shared utilities in `-shared.ts`; `src/core/db/` helpers (`doctor`, `vacuum`, `rebuildFts`) correctly accept a connection rather than opening their own.

---

## 7) What is working well (verified, keep doing this)

1. `cosineSimilarity`/`vectorNorm` defined once (`analysis/vectorSearch.ts:100-128`), imported by 19 modules.
2. `bufferToFloat32` centralized in `utils/embedding.ts` (§11.4 refactor) — previously inlined in 13 files.
3. `utils/outputSink.ts` adopted by 40+ commands; `utils/parse.ts` for int validation.
4. Grouped help with custom formatter; cross-referenced descriptions; hidden deprecation aliases.
5. Documented flag defaults match the code (10/10 spot-checks).
6. Versioned, idempotent schema migrations centralized in `sqlite.ts`.

---

## 8) Concrete improvement points (priority order)

1. **Re-wire the six unreachable commands** (`first-seen`, `file-evolution`, `pr-report`, `triage`, `policy check`, `ownership`): call `registerAnalysis()` from `registerAll`, delete the six duplicates from `all.ts:499-563`, re-register the two file-history commands, fix the false comment at `all.ts:147`.
2. **Add a wiring regression test**: every `COMMAND_GROUPS` key must resolve to a registered command; unknown commands must exit non-zero (today they print root help and exit 0).
3. **Make CI green**: restore README command tables (or formally re-point the canonical user docs at `features.md` and update `docsSync.test.ts` + CLAUDE.md policy to match). Fix the `features.md` header (v0.90.11 / schema v21) and CLAUDE.md's MCP tool count (32).
4. **Extract CLI shared helpers** (`src/cli/lib/`): `buildProviderOrExit` (14 drifting copies), model resolution (19 files), JSON-sink epilogue (~35 files), and shared actionable errors for "index missing / provider unreachable".
5. **Finish the `src/core/search/` reorg in one pass**: kill all shims, the `core/` shim dir, the duplicated `booleanSearch.ts`, and the barrel `index.ts`; update imports/tests to canonical paths.
6. **Unify output flags on `--out`** with deprecated hidden aliases for `--dump`/`--html`/`--format`; add a flag-consistency test.
7. **Adopt an exit-code scheme** (1 runtime / 2 usage / 3 gate-failed) for the CI-facing commands first.
8. **Give `workflow` a description**; rename `policy check` → `policy-check`.
9. **Standardize `--since`/`--until`** and `-k, --top`; document threshold scales (similarity vs distance) in every help string.
10. **Clean the repo root**: one lockfile, delete `index.js`/`index.log`/`tmp/`/stale notes, gitignore `tmp/` and `*.log`.

---

*Methodology: three parallel audits (CLI wiring/UX, docs↔interface parity, core reuse/structure) followed by manual runtime verification of every high-severity claim: fresh `pnpm build`, direct invocation of affected commands, `vitest run tests/docsSync.test.ts`, grep/hash comparison of duplicated definitions, and git history tracing of the breaking commits (`6a328f4`, `281244a`).*
