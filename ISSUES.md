# Issues

This file tracks known issues and reproducible bugs for the gitsema project.


## Bug: `search --after` / `--before` filters use blob first-seen timestamp (snapshot filtering mismatch)

 - **Status:** Open
 - **GitHub issue:** https://github.com/jsilvanus/gitsema/issues/65
 - **Reported by:** user
 - **Date:** 2026-04-11

### Description

Using `gitsema search "<query>" --after <date>` (or `--before`) currently filters candidate blobs by the blob's *first-seen* commit timestamp. This excludes blobs that are present in the current snapshot (HEAD) but whose first introduction in history predates the filter date. As a result, `gitsema search` with `--after` does not cover the expected snapshot set.

### Reproduction

1. Ensure the repo is indexed (`gitsema index`).
2. Run: `gitsema search "Embedder" --after 2026-04-10`
3. Observed: Results only include blobs whose first introduction commit is after `2026-04-10`. Files present in HEAD that were modified after that date but whose blob was originally introduced earlier are excluded.

### Expected

`--after` / `--before` should support snapshot-aware date filtering: when the user intends to search the current snapshot (default), filtering by date should include files present in that snapshot that were last changed (or are present as of) the requested date range. At minimum, the behaviour should be documented and/or an option provided to choose between "first-seen" vs "snapshot-last-seen" semantics.

### Actual

The implementation uses the blob's earliest commit timestamp (first-seen) for both the `filterByTimeRange` helper and recency score computation, which is not the expected behaviour for snapshot-level searches.

### Location (code pointers)

- `src/core/search/temporal/timeSearch.ts` — `getFirstSeenMap()` and `filterByTimeRange()` (filters by earliest commit timestamp)
- `src/core/search/analysis/vectorSearch.ts` — calls `filterByTimeRange()` to restrict candidate blobs for searches
- `src/cli/commands/search.ts` — CLI flag parsing and wiring of `--after` / `--before`

### Suggested fixes / options

1. Add snapshot-aware filtering: implement `getLastSeenMap()` (or `getPresenceAtRefMap()`) to obtain the most recent commit timestamp for a blob within the active ref/snapshot and use that for `--after` / `--before` when the search is intended to target a snapshot (e.g., default `HEAD`).
2. Preserve current `first-seen` behaviour for use-cases that need origin data (e.g. concept evolution), and expose a CLI flag `--time-semantics=first-seen|last-seen|presence` to select behaviour.
3. Alternatively, document the current behaviour clearly in CLI help and `docs/` and add a note in `ISSUES.md` until a code change is made.

### Suggested PR checklist

- [ ] Add `getLastSeenMap()` and unit tests in `tests/` demonstrating expected behaviour
- [ ] Update `filterByTimeRange()` or add a `filterByTimeRangeAtRef()` variant
- [ ] Add integration tests covering `gitsema search --after/--before` against a small test repo
- [ ] Update CLI help text in `src/cli/register/search.ts` and `README.md`

### Notes

This issue can break workflows where users expect date filters to operate over the *current snapshot* rather than the blob's origin in Git history. The change must be made carefully to avoid breaking existing consumers that rely on first-seen semantics.
