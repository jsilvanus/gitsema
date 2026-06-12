Bug: `search --after` / `--before` filters use blob first-seen timestamp (snapshot filtering mismatch)

Description:
Using `gitsema search "<query>" --after <date>` currently filters candidate blobs by the blob's *first-seen* commit timestamp. This excludes blobs that are present in the current snapshot (HEAD) but whose first introduction in history predates the filter date. As a result, `gitsema search` with `--after` does not cover the expected snapshot set.

Reproduction:
1. Ensure the repo is indexed (`gitsema index`).
2. Run: `gitsema search "Embedder" --after 2026-04-10`
3. Observed: Results only include blobs whose first introduction commit is after `2026-04-10`.

Expected:
`--after` / `--before` should support snapshot-aware date filtering: when the user intends to search the current snapshot (default), filtering by date should include files present in that snapshot that were last changed (or are present as of) the requested date range.

Location (code pointers):
- `src/core/search/temporal/timeSearch.ts` — `getFirstSeenMap()` and `filterByTimeRange()`
- `src/core/search/analysis/vectorSearch.ts` — calls `filterByTimeRange()`
- `src/cli/commands/search.ts` — CLI flags wiring

Suggested fixes:
- Add `getLastSeenMap()` and/or `filterByTimeRangeAtRef()`; expose CLI flag `--time-semantics` or default to snapshot-aware semantics for HEAD.

