import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'

export interface BlobEntry {
  blobHash: string
  path: string
}

export interface RevListOptions {
  /**
   * Restrict which commits (and therefore blobs) are included.
   *
   * Accepted forms:
   *  - ISO date string (e.g. `"2024-01-01"`) → `--after=<date>` filter
   *  - Tag name (e.g. `"v1.2.0"`) → commits reachable from HEAD but not from that tag
   *  - Commit hash / symbolic ref (e.g. `"HEAD~100"`, `"abc1234"`) → same range form
   */
  since?: string
}

/** Returns true when the string looks like an ISO date rather than a git ref. */
function isDateString(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}([ T]|$)/.test(s)
}

/**
 * Streams all blob entries from the repo by piping:
 *   git rev-list --objects [--all | <since>..HEAD]
 *     | git cat-file --batch-check='%(objectname) %(objecttype) %(rest)'
 *
 * This lets us filter to only `blob` type objects and capture the path
 * in a single streaming pass without extra per-object subprocess calls.
 */
export function revList(repoPath: string = '.', options: RevListOptions = {}): Readable {
  const { since } = options

  let revListArgs: string[]
  if (!since) {
    revListArgs = ['rev-list', '--objects', '--all']
  } else if (isDateString(since)) {
    revListArgs = ['rev-list', '--objects', '--all', `--after=${since}`]
  } else {
    // Tag, branch, or commit hash: use a range to get only new objects
    revListArgs = ['rev-list', '--objects', `${since}..HEAD`]
  }

  const revListProc = spawn('git', revListArgs, {
    cwd: repoPath,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  // --batch-check reads object names from stdin; %(rest) captures the path portion
  const batchProc = spawn(
    'git',
    ['cat-file', "--batch-check=%(objectname) %(objecttype) %(rest)"],
    {
      cwd: repoPath,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )

  revListProc.stdout.pipe(batchProc.stdin)

  const out = new Readable({ objectMode: true, read() {} })

  const rl = createInterface({ input: batchProc.stdout, crlfDelay: Infinity })

  rl.on('line', (line) => {
    // format: "<hash> <type> <path>"  (path may be empty for commits/root trees)
    const parts = line.split(' ')
    if (parts.length < 2) return
    const [hash, type, ...rest] = parts
    if (type !== 'blob') return
    const path = rest.join(' ')
    if (!path) return
    out.push({ blobHash: hash, path } satisfies BlobEntry)
  })

  rl.on('close', () => out.push(null))

  batchProc.stderr.on('data', (chunk: Buffer) => {
    out.destroy(new Error(`git cat-file error: ${chunk.toString().trim()}`))
  })

  revListProc.on('error', (err) => out.destroy(err))
  batchProc.on('error', (err) => out.destroy(err))

  return out
}
