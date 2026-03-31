import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'

export interface CommitEntry {
  commitHash: string
  timestamp: number
  message: string
}

export interface BlobCommitEntry {
  blobHash: string
  commitHash: string
}

export type CommitMapEvent =
  | { type: 'commit'; data: CommitEntry }
  | { type: 'blob'; data: BlobCommitEntry }

/**
 * Streams commit metadata and new blob introductions from git history.
 *
 * For each commit: emits a 'commit' event with hash, timestamp, and message.
 * For each added or modified blob in that commit: emits a 'blob' event.
 *
 * Uses `git log --all --raw` to capture all commits across all branches and
 * their associated blob changes in a single streaming pass.
 */
export interface CommitMapOptions {
  /**
   * Stop after this many commits have been traversed.
   * Should match the same limit passed to `revList` so Phase A and Phase B
   * cover the same set of commits.
   */
  maxCommits?: number
}

export function streamCommitMap(repoPath: string = '.', options: CommitMapOptions = {}): Readable {
  const { maxCommits } = options
  const args = ['log', '--all', '--raw', '--no-abbrev', '--format=COMMIT %H %ct %s']
  if (maxCommits && maxCommits > 0) {
    args.push(`--max-count=${maxCommits}`)
  }
  const proc = spawn('git', args, {
    cwd: repoPath,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const out = new Readable({ objectMode: true, read() {} })

  let currentCommitHash = ''

  const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity })

  rl.on('line', (line) => {
    if (line.startsWith('COMMIT ')) {
      // Parse: "COMMIT <hash> <timestamp> <message>"
      const rest = line.slice('COMMIT '.length)
      const parts = rest.split(' ')
      if (parts.length < 2) return
      const commitHash = parts[0]
      // Validate that this looks like a real commit hash (SHA-1: 40 chars, SHA-256: 64 chars)
      if (!/^[0-9a-f]{40,64}$/.test(commitHash)) return
      const timestamp = parseInt(parts[1], 10)
      if (isNaN(timestamp)) return
      const message = parts.slice(2).join(' ')
      currentCommitHash = commitHash
      out.push({ type: 'commit', data: { commitHash, timestamp, message } } satisfies CommitMapEvent)
    } else if (line.startsWith(':') && currentCommitHash) {
      // Raw diff line: ":old_mode new_mode old_hash new_hash status\tpath"
      const tabIdx = line.indexOf('\t')
      if (tabIdx === -1) return
      const header = line.slice(1, tabIdx) // strip leading ':'
      const parts = header.split(' ')
      if (parts.length < 5) return
      const status = parts[4]
      // Only process added (A) or modified (M) entries — these introduce a new blob hash
      if (status !== 'A' && status !== 'M') return
      const newBlobHash = parts[3]
      // Skip null hash (e.g., deletions or submodule commits)
      if (/^0+$/.test(newBlobHash)) return
      out.push({ type: 'blob', data: { blobHash: newBlobHash, commitHash: currentCommitHash } } satisfies CommitMapEvent)
    }
    // Blank lines and other lines (tree headers, etc.) are ignored
  })

  rl.on('close', () => out.push(null))

  proc.stderr.on('data', (chunk: Buffer) => {
    out.destroy(new Error(`git log error: ${chunk.toString().trim()}`))
  })

  proc.on('error', (err) => out.destroy(err))

  return out
}
