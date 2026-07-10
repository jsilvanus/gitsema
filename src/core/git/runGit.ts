/**
 * Shared, injection-safe `git` invocation helper (Phase 150 / review11 §2.1
 * + §3.2).
 *
 * Background: review9/10 fixed the *shell-string* form of git command
 * injection by switching call sites from `execSync(\`git … ${x}\`)` (shell)
 * to `execFileSync('git', [...])` (no shell). That defeats shell
 * metacharacters (`;`, `|`, `$()`) but **not** git's own option parser — an
 * argument beginning with `-` is still parsed as a *flag*, not a positional
 * value. `git log --output=<file>` (and similarly dangerous flags on other
 * subcommands) then becomes an arbitrary-file-write primitive when a
 * network-facing caller controls a "ref" string end-to-end
 * (`semantic_bisect`/`triage`, review11 §2.1, PoC-confirmed).
 *
 * `runGit()` closes this at the sink, uniformly, for every call site that
 * takes a caller-influenced ref:
 *  1. Every `ref` is validated with `isSafeGitRange()` before git ever runs
 *     — rejects leading `-` and any character outside normal git revision
 *     syntax.
 *  2. The argv always inserts git's `--end-of-options` marker immediately
 *     before the refs, so even a ref that somehow passed validation could
 *     never be parsed as a flag.
 *
 * Why `--end-of-options` and not a bare `--`: git's plain `--` separates
 * *revisions* (before it) from *pathspecs* (after it) for commands like
 * `log`/`show` — putting a ref after a bare `--` makes git treat it as a
 * pathspec instead of a revision, silently breaking resolution of valid refs
 * (verified empirically: `git log -1 --format=%ct -- HEAD~1` prints nothing,
 * `git log -1 --format=%ct --end-of-options HEAD~1` resolves correctly).
 * `--end-of-options` (git ≥ 2.24) is git's own mechanism for exactly this:
 * "stop parsing option flags here" without reclassifying what follows.
 */

import { execFileSync } from 'node:child_process'
import type { ExecFileSyncOptionsWithStringEncoding } from 'node:child_process'
import { isSafeGitRange } from './refSafety.js'

/**
 * `runGit()` always returns a string, so callers may omit `encoding`
 * (it defaults to 'utf8'); everything else in the exec options is passthrough.
 */
export type RunGitOptions = Omit<ExecFileSyncOptionsWithStringEncoding, 'encoding'> & {
  encoding?: ExecFileSyncOptionsWithStringEncoding['encoding']
}

export class UnsafeGitRefError extends Error {
  constructor(ref: string) {
    super(`Unsafe git ref: ${JSON.stringify(ref)}`)
    this.name = 'UnsafeGitRefError'
  }
}

/**
 * Runs `git <subcommand> [...flags] --end-of-options [...refs]` and returns
 * stdout. Throws `UnsafeGitRefError` (without spawning git) if any `ref`
 * fails `isSafeGitRange()`.
 *
 * `flags` are developer-controlled option strings (e.g. `-1`,
 * `--format=%ct`) — never pass caller-supplied input as a flag. `refs` are
 * caller-influenced positional values (commit hashes, branch names, ranges)
 * — always pass caller-supplied revision input here, never in `flags`.
 */
export function runGit(
  subcommand: string,
  flags: string[],
  refs: string[],
  options: RunGitOptions,
): string {
  for (const ref of refs) {
    if (!isSafeGitRange(ref)) {
      throw new UnsafeGitRefError(ref)
    }
  }
  const argv = [subcommand, ...flags, '--end-of-options', ...refs]
  return execFileSync('git', argv, { ...options, encoding: options.encoding ?? 'utf8' })
}
