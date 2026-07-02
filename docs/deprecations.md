# Deprecations

Canonical list of every deprecated command, flag, and transport in gitsema:
what replaced it, when it was deprecated, and whether (and when) it's
scheduled for removal.

**Last updated:** 2026-07-02

**Removal policy:** gitsema has never set a removal date for anything in this
file. Every hard deprecation below has been kept indefinitely since it was
introduced — the project's practice so far is "warn forever, remove only if
a specific reason arises" rather than time-boxed sunsetting. If that changes
for a given item, this file is the place that says so (see the "Removal"
column) — check here, not assumptions, before relying on "deprecated things
eventually disappear."

---

## 1. Hard deprecations (runtime warning printed, replacement exists)

These print a `Deprecation notice: ...` (or equivalent) to stderr on every
invocation, steering the caller to a replacement. They remain fully
functional — the warning is the only behavior change.

| Deprecated form | Replacement | Since | Removal | Evidence |
|---|---|---|---|---|
| `gitsema mcp` | `gitsema tools mcp` | Phase 59 (v0.61.0) | Not scheduled | `src/cli/register/all.ts:507-509` |
| `gitsema lsp` | `gitsema tools lsp` | Phase 59 (v0.61.0) | Not scheduled | `src/cli/commands/lsp.ts:7-10` |
| `gitsema serve` | `gitsema tools serve` | Phase 59 (v0.61.0) | Not scheduled | `src/cli/register/all.ts:276-283` |
| `gitsema doctor` | `gitsema index doctor` | Phase 71 (v0.71.0) | Not scheduled | `src/cli/register/indexing.ts:251-258` |
| `gitsema vacuum` | `gitsema index vacuum` | Phase 71 (v0.71.0) | Not scheduled | `src/cli/register/indexing.ts:264-266` |
| `gitsema rebuild-fts` | `gitsema index rebuild-fts` | Phase 71 (v0.71.0) | Not scheduled | `src/cli/register/indexing.ts:272-275` |
| `gitsema backfill-fts` | `gitsema index rebuild-fts` | Phase 71 (v0.71.0); retargeted Phase 128 | Not scheduled | `src/cli/register/indexing.ts:280-285` |
| `gitsema index backfill-fts` | `gitsema index rebuild-fts` | Phase 128 | Not scheduled | `src/cli/register/indexing.ts:193-199` |
| `gitsema update-modules` | `gitsema index update-modules` | Phase 71 (v0.71.0) | Not scheduled | `src/cli/register/indexing.ts:289-292` |
| `gitsema gc` | `gitsema index gc` | Phase 71 (v0.71.0) | Not scheduled | `src/cli/register/indexing.ts:298-302` |
| `gitsema clear-model` | `gitsema index clear-model` | Phase 71 (v0.71.0) | Not scheduled | `src/cli/register/indexing.ts:315-318` |
| `gitsema build-vss` | `gitsema index build-vss` | Phase 71 (v0.71.0) | Not scheduled | `src/cli/register/indexing.ts:324-329` |
| `gitsema policy check` (two-word) | `gitsema policy-check` (kebab-case) | Phase 94 (v0.91.0) | Not scheduled | `src/cli/register/analysis.ts:63-75` |
| `POST /api/v1/analysis/multi-repo-search` | `POST /api/v1/search` with a `repos: string[]` body param | Phase 138 | Not scheduled | `src/server/routes/analysis.ts` (`multi-repo-search` handler); response carries a `Deprecation: true` header + a `Link: </api/v1/search>; rel="successor-version"` header on every call instead of a stderr warning (this is an HTTP route, not a CLI command) |

`POST /analysis/multi-repo-search`'s bare 4-param shape (`query`, `repoIds`,
`topK`, `model`) can't express `POST /search`'s full query-shaping surface
(levels, hybrid, boolean composition, model overrides, etc.). Rather than
grow two divergent multi-repo implementations, `POST /search`'s new `repos`
param became the parity-complete replacement (mirroring CLI `search
--repos`), and the old route was kept working, unchanged in response shape,
as a thin alias over the same `multiRepoSearch()` core call.

`backfill-fts` re-fetched blob content from Git for blobs indexed before
Phase 11, which never got an FTS5 row at all — `rebuild-fts` only re-syncs
`blob_fts` from content already present and cannot recover those rows. The
two commands are not strictly interchangeable, but no index database
predating Phase 11 is still in active use, so the gap `backfill-fts` closed
no longer applies in practice; `rebuild-fts` is the recommended command for
all current FTS maintenance.

---

## 2. Legacy flags (no runtime warning, auto-translated, no removal plan)

Introduced by Phase 70's (v0.69.0) unified `--out <format>[:<file>]` output
system. `--dump`, `--html`, and `--format` are transparently translated to an
equivalent `--out` spec internally (`resolveOutputs()` in
`src/utils/outputSink.ts`) on every command that accepts `--out`. Unlike §1,
these print **no warning** — they are documented in `--help` text as
`(legacy: prefer --out <fmt>)` but are not flagged as deprecated, and there
is no indication they will ever be removed (existing scripts that use them
keep working identically). Present on: `search`, `evolution`
(`concept-evolution`), `first-seen`, `file-evolution`, `triage`,
`policy-check`, `ownership`, `workflow run`, `experts`, `dead-concepts`,
`impact`, `clusters`, `cluster-diff`, `cluster-timeline`, `change-points`,
`file-change-points`, `cluster-change-points`, `branch-summary`,
`merge-audit`, `merge-preview`, `author`, `narrate`/`explain`, `ci-diff`,
`security-scan`, `debt`, `graph` subcommands, and others — see each
command's `--help` output for the exact flag set.

| Legacy flag | Preferred form |
|---|---|
| `--dump [file]` | `--out json[:file]` |
| `--html [file]` | `--out html[:file]` |
| `--format <fmt>` | `--out <fmt>[:file]` |

---

## 3. Silent aliases (alternate names, not deprecated, no warning, no removal plan)

These are not deprecations at all — both forms are first-class, permanently
supported names for the same command, kept for discoverability or muscle
memory. Listed here only so this file is a complete map of "is X going
away?" questions; **do not** read these as deprecated.

| Alias | Canonical form | Evidence |
|---|---|---|
| `gitsema concept-evolution` | `gitsema evolution` | `src/cli/register/all.ts:61-62` |
| `gitsema semantic-blame` | `gitsema blame` | `src/cli/register/all.ts:307-308` |
| `gitsema export-index` (hidden) | `gitsema index export` | `src/cli/register/indexing.ts:148-156` |
| `gitsema import-index` (hidden) | `gitsema index import` | `src/cli/register/indexing.ts:158-165` |

---

## 4. Superseded mechanisms (no warning, no removal plan)

Not deprecated — both the old and new mechanism remain fully supported and
print no warning — but the newer mechanism is the recommended path for new
integrations. Listed here so "is there a better way to do this now?"
questions have an answer.

| Superseded mechanism | Modern replacement | Since | Notes |
|---|---|---|---|
| `gitsema repos token add/list/revoke` (per-repo scoped tokens, `repo_tokens` table) | `gitsema repos grant/grants/revoke` (`repo_grants` table, Phase 123) | Phase 123 (multi-tenant-auth §5 Phase B) | `repo_tokens` grants a single bearer-token credential scoped to one repo with no user identity attached; `repo_grants` ties a role (`read`\|`write`\|`owner`), optionally branch-scoped, to an actual `users` row created via Phase 122's identity core, and integrates with orgs/membership. Both tables and their CLI/HTTP surfaces continue to work side by side — no removal planned for `repo_tokens`. |

---

## How to use this document

- **"Will my script break?"** — check §1 first. If your command/flag is
  there, it still works today; only the replacement column tells you what
  to migrate to, and the Removal column tells you if/when it stops working
  (currently: never, for everything listed).
- **Adding a new deprecation:** add a row to §1 (or §2 if it's a silent
  flag translation, not a warned-and-replaced command), citing the
  Commander registration site (`file:line`) and the PLAN.md phase that
  introduced it. If you set an actual removal date or version, put it in
  the Removal column — don't leave future readers guessing.
- **Removing something that was deprecated here:** delete its row only
  after the removal has actually shipped (not when it's merely planned),
  and note the removal in a `docs/PLAN.md` phase entry the same way the
  deprecation itself was documented.
