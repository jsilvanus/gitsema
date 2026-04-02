# Phase X — Evolution Timeline CLI with Actionable Links

## Overview

This phase turns the existing `gitsema evolution` output into an **actionable CLI report**:
the top-N largest semantic jumps, enriched with commit author information, web commit links,
and ready-to-parse JSON output that agents and CI pipelines can consume directly.

## Motivation

Code owners and maintainers often need to triage unusual semantic changes without inspecting
the full file history manually.  The pre-existing `evolution` command already computes cosine
distances between consecutive file versions, but it presented every version equally, making it
hard to identify the most significant changes at a glance.

## New flag: `--alerts [n]`

```
gitsema evolution <path> --alerts [n]
```

When `--alerts` is supplied the command ranks every version whose `distFromPrev` exceeds the
threshold (default `0.3`), sorts them **descending** by delta score, and displays the top-`n`
results (default `5`).  A custom count can be passed directly: `--alerts 10`.

For each alert the report shows:

| Field | Description |
|---|---|
| `rank` | 1-based position in the sorted alert list |
| `date` | Date the blob first appeared (`YYYY-MM-DD`) |
| `blob` | Short blob SHA-1 |
| `commit` | Short commit SHA-1 |
| `Δprev` | Cosine distance from the previous version |
| `Δorigin` | Cosine distance from the first (origin) version |
| `Author` | Git commit author (`Name <email>`) if available |
| commit URL | Web link to the commit on GitHub, GitLab, or Bitbucket if the `origin` remote is recognised |

### Example output

```
Evolution of: src/core/indexing/indexer.ts
Versions found: 12

⚠  Top 3 largest semantic jumps for src/core/indexing/indexer.ts:

  #1  2024-03-10  blob:a3f9c2d  commit:b19e4a1  Δprev=0.6120  Δorigin=0.5890
      Author: Alice Smith <alice@example.com>
      https://github.com/org/repo/commit/b19e4a1abc...
  #2  2023-11-22  blob:d00f7e3  commit:c44a2b9  Δprev=0.4410  Δorigin=0.4100
      Author: Bob Jones <bob@example.com>
      https://github.com/org/repo/commit/c44a2b9def...
  #3  2023-06-01  blob:e81c9f5  commit:f7d3b20  Δprev=0.3150  Δorigin=0.2900
```

### JSON output with `--dump`

Combining `--alerts` with `--dump` adds an `alerts` array to the JSON object:

```
gitsema evolution src/core/indexing/indexer.ts --alerts 5 --dump alerts.json
```

```json
{
  "path": "src/core/indexing/indexer.ts",
  "versions": 12,
  "threshold": 0.3,
  "timeline": [ ... ],
  "summary": { "largeChanges": 4, "maxDistFromPrev": 0.612, "totalDrift": 0.721 },
  "alerts": [
    {
      "rank": 1,
      "index": 7,
      "date": "2024-03-10",
      "blobHash": "a3f9c2d...",
      "commitHash": "b19e4a1...",
      "distFromPrev": 0.612,
      "distFromOrigin": 0.589,
      "author": "Alice Smith <alice@example.com>",
      "commitUrl": "https://github.com/org/repo/commit/b19e4a1..."
    }
  ]
}
```

## Commit URL construction

The helper `buildCommitUrl(commitHash, remoteUrl)` (exported from
`src/core/search/evolution.ts`) maps an `origin` remote URL to a web commit link.

Supported hosts and URL patterns:

| Host | Remote format | Commit URL |
|---|---|---|
| GitHub | `https://github.com/org/repo.git` or `git@github.com:org/repo.git` | `https://github.com/org/repo/commit/<hash>` |
| GitLab | `https://gitlab.com/org/repo.git` or `git@gitlab.com:org/repo.git` | `https://gitlab.com/org/repo/-/commit/<hash>` |
| Bitbucket | `https://bitbucket.org/org/repo.git` or `git@bitbucket.org:org/repo.git` | `https://bitbucket.org/org/repo/commits/<hash>` |

If the remote is not recognised, `commitUrl` is omitted from the output.

## Suggested reviewer

The alert's `author` field is populated by running:

```
git log -1 --format='%an <%ae>' <commitHash>
```

This surfaces the commit author for each large semantic jump, giving maintainers a starting
point for code review triage.

## New exports

| Symbol | Module | Purpose |
|---|---|---|
| `buildCommitUrl(commitHash, remoteUrl)` | `src/core/search/evolution.ts` | Pure function; constructs a web commit link from a remote URL |
| `getRemoteUrl(repoPath?)` | `src/core/search/evolution.ts` | Async; reads `origin` remote URL via `git remote get-url` |
| `getCommitAuthor(commitHash, repoPath?)` | `src/core/search/evolution.ts` | Async; retrieves commit author via `git log` |
| `buildAlerts(entries, threshold, topN)` | `src/cli/commands/evolution.ts` | Pure; returns top-N alert candidates sorted by delta descending |
| `EvolutionAlert` (interface) | `src/cli/commands/evolution.ts` | Alert entry type with `rank`, `author`, `commitUrl` |

## Implementation notes

- `--alerts` is fully additive — existing behaviour (`--dump`, `--threshold`, `--include-content`,
  `--origin`, `--remote`) is unchanged when `--alerts` is not passed.
- Alert enrichment (author + commit URL) runs after `computeEvolution()`, so it does not
  affect the synchronous core computation path.
- The `buildAlerts` and `buildCommitUrl` functions are pure and have unit test coverage in
  `tests/evolution.test.ts`.
- Complexity: Low.
