---
"gitsema": patch
---

Security (Phase 150 / review11 §2.1 + §3.2): close the network-reachable git
argument-injection sink. A caller-supplied "ref" beginning with `-` (e.g.
`--output=/path`) was parsed by git as a *flag*, turning `git log` into an
arbitrary-file-write primitive reachable via `semantic_bisect`/`triage`. All
git call sites that take a user-influenced ref now route through a shared
`runGit()` helper that rejects leading-`-` refs before spawning git and always
inserts git's `--end-of-options` separator so a value can never be read as a
flag (`resolveRefToTimestamp`, `parseDateArg`, `getMergeBase`,
`getBranchExclusiveBlobs`).
