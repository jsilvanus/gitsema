import { getActiveSession } from '../db/sqlite.js'
import { isSafeGitRange } from './refSafety.js'
import { runGit, UnsafeGitRefError } from './runGit.js'

/**
 * Returns the merge-base commit hash for two branches/refs.
 *
 * Runs `git merge-base <branchA> <branchB>` via `runGit()`, which rejects
 * unsafe refs (leading `-`) before spawning git and always separates the
 * positional refs with `--end-of-options` (Phase 150 / review11 §3.2).
 * Throws if the branches have no common ancestor or git fails.
 */
export function getMergeBase(branchA: string, branchB: string, repoPath = '.'): string {
  let out: string
  try {
    out = runGit('merge-base', [], [branchA, branchB], {
      cwd: repoPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch (err) {
    if (err instanceof UnsafeGitRefError) {
      throw new Error(`Unsafe git ref supplied to merge-base: ${JSON.stringify({ branchA, branchB })}`)
    }
    throw new Error(
      `Cannot find merge base for "${branchA}" and "${branchB}": ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  if (!out || !/^[0-9a-f]{40,64}$/.test(out)) {
    throw new Error(`Unexpected output from git merge-base: "${out}"`)
  }
  return out
}

/**
 * Returns indexed blob hashes introduced on `branch` since `mergeBaseHash`.
 *
 * Steps:
 *  1. Runs `git log <mergeBaseHash>..<branch> --format=%H` to list commits
 *     that are exclusive to the branch (reachable from `branch` but not from
 *     `mergeBaseHash`).
 *  2. Batch-queries `blob_commits` to find indexed blobs introduced by those
 *     commits.
 *
 * Blobs not yet in the gitsema index are silently excluded.
 * Returns an empty array when the range is empty or the branch is not found.
 */
export function getBranchExclusiveBlobs(
  branch: string,
  mergeBaseHash: string,
  repoPath = '.',
): string[] {
  if (!isSafeGitRange(branch) || !isSafeGitRange(mergeBaseHash)) {
    return []
  }

  let gitOutput: string
  try {
    gitOutput = runGit(
      'log',
      ['--format=%H'],
      [`${mergeBaseHash}..${branch}`],
      { cwd: repoPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
  } catch {
    return [] // unsafe ref, branch not found, or no git; return empty gracefully
  }

  const commitHashes = gitOutput
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => /^[0-9a-f]{40,64}$/.test(s))

  if (commitHashes.length === 0) return []

  const { rawDb } = getActiveSession()
  const BATCH = 500
  const blobHashes = new Set<string>()

  for (let i = 0; i < commitHashes.length; i += BATCH) {
    const batch = commitHashes.slice(i, i + BATCH)
    const placeholders = batch.map(() => '?').join(',')
    const rows = rawDb
      .prepare(
        `SELECT DISTINCT blob_hash FROM blob_commits WHERE commit_hash IN (${placeholders})`,
      )
      .all(...batch) as Array<{ blob_hash: string }>
    for (const row of rows) blobHashes.add(row.blob_hash)
  }

  return [...blobHashes]
}
