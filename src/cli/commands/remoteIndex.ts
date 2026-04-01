/**
 * `gitsema remote-index <repoUrl>` — Phase 16 + Phase 17.
 *
 * Phase 16: sends a synchronous POST /api/v1/remote/index.
 * Phase 17: async job API — POST returns { jobId }, then streams SSE progress.
 *
 * New Phase 17 options:
 *   --ssh-key <path>   Path to a PEM-encoded SSH private key file
 *   --db-label <label> Route indexing to .gitsema/<label>.db on the server
 */

import { readFile } from 'node:fs/promises'
import { remoteIndexRepo } from '../../client/remoteClient.js'
import type { RemoteIndexOptions, RemoteIndexRequest } from '../../client/remoteClient.js'
import type { IndexStats } from '../../core/indexing/indexer.js'

export interface RemoteIndexCommandOptions {
  remote?: string
  token?: string
  sshKey?: string
  depth?: string
  since?: string
  maxCommits?: string
  concurrency?: string
  ext?: string
  maxSize?: string
  exclude?: string
  chunker?: string
  windowSize?: string
  overlap?: string
  dbLabel?: string
}

export async function remoteIndexCommand(
  repoUrl: string,
  options: RemoteIndexCommandOptions,
): Promise<void> {
  // --remote overrides GITSEMA_REMOTE
  if (options.remote) process.env.GITSEMA_REMOTE = options.remote

  if (!process.env.GITSEMA_REMOTE) {
    console.error(
      'Error: --remote <url> or GITSEMA_REMOTE environment variable is required for remote-index',
    )
    process.exit(1)
  }

  // Validate URL format (HTTPS or SSH — no other protocols allowed)
  let parsedUrl: URL | null = null
  let isScp = false

  if (repoUrl.includes('://')) {
    try {
      parsedUrl = new URL(repoUrl)
    } catch {
      console.error(`Error: Invalid URL: ${repoUrl}`)
      process.exit(1)
    }
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'ssh:') {
      console.error(
        `Error: Only https:// and ssh:// URLs are supported (got ${parsedUrl.protocol})`,
      )
      process.exit(1)
    }
  } else {
    // SCP-style: git@host:owner/repo.git
    const scpMatch = repoUrl.match(/^(?:[^@/]+@)?([^:/]+):/)
    if (!scpMatch) {
      console.error(`Error: Unsupported URL format: ${repoUrl}`)
      process.exit(1)
    }
    isScp = true
  }

  // --token and --ssh-key are mutually exclusive
  if (options.token && options.sshKey) {
    console.error('Error: --token and --ssh-key are mutually exclusive')
    process.exit(1)
  }

  // SSH key requires a non-HTTPS URL
  if (options.sshKey && parsedUrl?.protocol === 'https:') {
    console.error('Error: --ssh-key requires an SSH URL (ssh:// or git@host:...)')
    process.exit(1)
  }

  const cloneDepth = options.depth !== undefined ? parseInt(options.depth, 10) : undefined
  if (cloneDepth !== undefined && (isNaN(cloneDepth) || cloneDepth < 1)) {
    console.error('Error: --depth must be a positive integer')
    process.exit(1)
  }

  const concurrency = options.concurrency !== undefined
    ? parseInt(options.concurrency, 10)
    : undefined
  if (concurrency !== undefined && (isNaN(concurrency) || concurrency < 1)) {
    console.error('Error: --concurrency must be a positive integer')
    process.exit(1)
  }

  const maxCommits = options.maxCommits !== undefined
    ? parseInt(options.maxCommits, 10)
    : undefined
  if (maxCommits !== undefined && (isNaN(maxCommits) || maxCommits < 1)) {
    console.error('Error: --max-commits must be a positive integer')
    process.exit(1)
  }

  // Validate dbLabel format (must match the server-side regex)
  if (options.dbLabel !== undefined && !/^[a-zA-Z0-9-]{1,64}$/.test(options.dbLabel)) {
    console.error('Error: --db-label must be 1–64 alphanumeric characters or hyphens')
    process.exit(1)
  }

  // Build credentials
  let credentials: RemoteIndexRequest['credentials']
  if (options.token) {
    credentials = { type: 'token', token: options.token }
  } else if (options.sshKey) {
    let pemKey: string
    try {
      pemKey = await readFile(options.sshKey, 'utf8')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`Error reading SSH key file ${options.sshKey}: ${msg}`)
      process.exit(1)
    }
    credentials = { type: 'sshKey', key: pemKey }
  }

  const indexOptions: RemoteIndexOptions = {}
  if (options.since !== undefined) indexOptions.since = options.since
  if (maxCommits !== undefined) indexOptions.maxCommits = maxCommits
  if (concurrency !== undefined) indexOptions.concurrency = concurrency
  if (options.ext !== undefined) {
    indexOptions.ext = options.ext.split(',').map((e) => e.trim()).filter(Boolean)
  }
  if (options.maxSize !== undefined) indexOptions.maxSize = options.maxSize
  if (options.exclude !== undefined) {
    indexOptions.exclude = options.exclude.split(',').map((e) => e.trim()).filter(Boolean)
  }
  if (options.chunker !== undefined) {
    if (options.chunker !== 'file' && options.chunker !== 'function' && options.chunker !== 'fixed') {
      console.error('Error: --chunker must be one of: file, function, fixed')
      process.exit(1)
    }
    indexOptions.chunker = options.chunker as 'file' | 'function' | 'fixed'
  }
  if (options.windowSize !== undefined) {
    const n = parseInt(options.windowSize, 10)
    if (isNaN(n) || n < 1) {
      console.error('Error: --window-size must be a positive integer')
      process.exit(1)
    }
    indexOptions.windowSize = n
  }
  if (options.overlap !== undefined) {
    const n = parseInt(options.overlap, 10)
    if (isNaN(n) || n < 0) {
      console.error('Error: --overlap must be a non-negative integer')
      process.exit(1)
    }
    indexOptions.overlap = n
  }

  const urlDisplay = isScp ? repoUrl : repoUrl
  console.log(`Requesting remote index of ${urlDisplay} …`)

  // Live progress line — written to stdout with \r so it updates in place.
  let progressLine = ''
  function renderProgress(stats: IndexStats): void {
    const line =
      `  Seen: ${stats.seen} | Indexed: ${stats.indexed} | ` +
      `Skipped: ${stats.skipped} | Failed: ${stats.failed}` +
      (stats.queued > 0 ? ` | Queued: ${stats.queued}` : '')
    progressLine = line
    process.stdout.write(`\r${line}`)
  }

  try {
    const stats = await remoteIndexRepo(
      {
        repoUrl,
        credentials,
        cloneDepth: cloneDepth ?? null,
        indexOptions,
        dbLabel: options.dbLabel,
      },
      renderProgress,
    )

    // Clear the progress line and print final stats.
    if (progressLine) {
      process.stdout.write('\r' + ' '.repeat(progressLine.length) + '\r')
    }

    console.log(`\nRemote index complete:`)
    console.log(`  Seen:      ${stats.seen}`)
    console.log(`  Indexed:   ${stats.indexed}`)
    console.log(`  Skipped:   ${stats.skipped}`)
    console.log(`  Oversized: ${stats.oversized}`)
    console.log(`  Filtered:  ${stats.filtered}`)
    console.log(`  Failed:    ${stats.failed}`)
    if (stats.fbFunction > 0) console.log(`  Fallback (function): ${stats.fbFunction}`)
    if (stats.fbFixed > 0) console.log(`  Fallback (fixed):    ${stats.fbFixed}`)
    console.log(`  Commits:   ${stats.commits}`)
    console.log(`  Elapsed:   ${(stats.elapsed / 1000).toFixed(1)}s`)
    if (options.dbLabel) {
      console.log(`  DB label:  ${options.dbLabel}`)
    }
  } catch (err: unknown) {
    if (progressLine) {
      process.stdout.write('\r' + ' '.repeat(progressLine.length) + '\r')
    }
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: ${msg}`)
    process.exit(1)
  }
}
