/**
 * Remote repository clone management (Phase 16 + Phase 17).
 *
 * Phase 16: HTTPS cloning with token credentials embedded in the URL.
 * Phase 17 additions:
 *   - GIT_ASKPASS credential helper: keeps token out of /proc/<pid>/cmdline
 *   - SSH repository URLs: ssh:// and SCP-style git@host:path
 *   - PEM SSH private key support via GIT_SSH_COMMAND
 */

import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { lookup } from 'node:dns/promises'
import { randomBytes } from 'node:crypto'
import { logger } from '../../utils/logger.js'

// ---------------------------------------------------------------------------
// Environment configuration
// ---------------------------------------------------------------------------

function cloneDir(): string {
  return process.env.GITSEMA_CLONE_DIR ?? tmpdir()
}

function cloneKeep(): 'always' | 'on-success' | 'keep' {
  const val = process.env.GITSEMA_CLONE_KEEP ?? 'always'
  if (val === 'always' || val === 'on-success' || val === 'keep') return val
  logger.warn(`Unknown GITSEMA_CLONE_KEEP value "${val}", defaulting to "always"`)
  return 'always'
}

function cloneMaxBytes(): number {
  const raw = process.env.GITSEMA_CLONE_MAX_BYTES
  if (raw) {
    const n = parseInt(raw, 10)
    if (!isNaN(n) && n > 0) return n
  }
  return 2 * 1024 * 1024 * 1024 // 2 GB
}

function cloneTimeoutMs(): number {
  const raw = process.env.GITSEMA_CLONE_TIMEOUT_MS
  if (raw) {
    const n = parseInt(raw, 10)
    if (!isNaN(n) && n > 0) return n
  }
  return 10 * 60 * 1000 // 10 minutes
}

function cloneConcurrency(): number {
  const raw = process.env.GITSEMA_CLONE_CONCURRENCY
  if (raw) {
    const n = parseInt(raw, 10)
    if (!isNaN(n) && n > 0) return n
  }
  return 2
}

// ---------------------------------------------------------------------------
// SSRF protection
// ---------------------------------------------------------------------------

/** IPv4/IPv6 CIDR ranges that must never be cloned from. */
const BLOCKED_PREFIXES_V4: Array<[number, number, number]> = [
  // [first octet, second octet (or -1 for any), prefix description]
  [127, -1, 8],   // 127.0.0.0/8   loopback
  [10, -1, 8],    // 10.0.0.0/8    private
  [169, 254, 16], // 169.254.0.0/16 link-local
  [192, 168, 16], // 192.168.0.0/16 private
]

function isPrivateIPv4(addr: string): boolean {
  const parts = addr.split('.').map(Number)
  if (parts.length !== 4 || parts.some(isNaN)) return false

  // 172.16.0.0/12 (172.16–172.31)
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true

  for (const [a, b] of BLOCKED_PREFIXES_V4) {
    if (parts[0] === a && (b === -1 || parts[1] === b)) return true
  }
  return false
}

function isPrivateIPv6(addr: string): boolean {
  const lower = addr.toLowerCase().replace(/^\[|\]$/g, '')
  if (lower === '::1') return true
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true // fc00::/7
  if (lower.startsWith('fe80')) return true // fe80::/10
  return false
}

/**
 * Extracts the hostname from any supported URL format:
 *  - Standard URLs: https://host/path, ssh://host/path
 *  - SCP-style: git@host:owner/repo.git
 *
 * Returns null for unrecognised formats.
 */
function extractHostname(rawUrl: string): { hostname: string; protocol: string } | null {
  // SCP-style (no ://): git@github.com:owner/repo.git or host:path
  if (!rawUrl.includes('://')) {
    const match = rawUrl.match(/^(?:[^@/]+@)?([^:/]+):/)
    if (match) {
      return { hostname: match[1], protocol: 'ssh' }
    }
    return null
  }

  try {
    const parsed = new URL(rawUrl)
    return { hostname: parsed.hostname, protocol: parsed.protocol.replace(':', '') }
  } catch {
    return null
  }
}

/**
 * Validates that a URL is safe to clone from.
 * Throws an error if the URL fails SSRF checks.
 *
 * Accepts:
 *  - https:// URLs
 *  - ssh:// URLs
 *  - SCP-style git@host:path URLs
 */
export async function validateCloneUrl(rawUrl: string): Promise<void> {
  const extracted = extractHostname(rawUrl)
  if (!extracted) {
    throw new Error(`Invalid or unsupported URL format: ${rawUrl}`)
  }

  const { hostname, protocol } = extracted

  if (protocol !== 'https' && protocol !== 'ssh') {
    throw new Error(`Only https:// and ssh:// (including SCP-style) URLs are allowed (got ${protocol}://)`)
  }

  if (!hostname) throw new Error('URL has no hostname')

  // Resolve hostname to IP and check for private/loopback addresses
  let addresses: string[]
  try {
    const results = await lookup(hostname, { all: true })
    addresses = results.map((r) => r.address)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`DNS resolution failed for ${hostname}: ${msg}`)
  }

  for (const addr of addresses) {
    if (isPrivateIPv4(addr)) {
      throw new Error(`SSRF: hostname ${hostname} resolves to private IPv4 address ${addr}`)
    }
    if (isPrivateIPv6(addr)) {
      throw new Error(`SSRF: hostname ${hostname} resolves to private IPv6 address ${addr}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Credential types (Phase 17: union type)
// ---------------------------------------------------------------------------

export type CloneCredentials =
  | { type: 'token'; token: string }
  | { type: 'sshKey'; key: string }

// ---------------------------------------------------------------------------
// URL sanitisation
// ---------------------------------------------------------------------------

/**
 * Returns a URL safe for logging — strips userinfo (credentials).
 * Handles standard URLs and SCP-style formats.
 */
export function sanitiseUrl(rawUrl: string): string {
  // SCP-style: git@host:path — no embedded credentials in the URL itself
  if (!rawUrl.includes('://')) {
    return rawUrl
  }
  try {
    const parsed = new URL(rawUrl)
    parsed.username = ''
    parsed.password = ''
    return parsed.toString()
  } catch {
    return '<invalid-url>'
  }
}

// ---------------------------------------------------------------------------
// GIT_ASKPASS credential helper (Phase 17)
// ---------------------------------------------------------------------------

/**
 * Writes a GIT_ASKPASS helper script to a temp file (mode 0700).
 * The script echoes the token regardless of the prompt — git calls it for
 * username and password separately but both return the token, which works
 * for most HTTPS token-based providers (GitHub, GitLab, Gitea).
 *
 * The file path must be deleted by the caller in a finally block.
 */
async function writeAskpassScript(token: string): Promise<string> {
  const id = randomBytes(8).toString('hex')
  const scriptPath = join(cloneDir(), `gitsema-askpass-${id}.sh`)
  // Escape single quotes in the token for safe shell embedding.
  // The only character that cannot appear in a single-quoted shell string is
  // a single quote — we handle it with the standard '\'' escape sequence.
  const safeToken = token.replace(/'/g, `'\\''`)
  const content = `#!/bin/sh\nprintf '%s' '${safeToken}'\n`
  await writeFile(scriptPath, content, { mode: 0o700 })
  return scriptPath
}

// ---------------------------------------------------------------------------
// SSH private key helper (Phase 17)
// ---------------------------------------------------------------------------

/**
 * Writes a PEM-encoded SSH private key to a temp file (mode 0600).
 * The file path must be deleted by the caller in a finally block.
 */
async function writeSshKey(pemKey: string): Promise<string> {
  const id = randomBytes(8).toString('hex')
  const keyPath = join(cloneDir(), `gitsema-sshkey-${id}`)
  // Ensure the key ends with a newline — some OpenSSH versions require it.
  const content = pemKey.endsWith('\n') ? pemKey : `${pemKey}\n`
  await writeFile(keyPath, content, { mode: 0o600 })
  return keyPath
}

// ---------------------------------------------------------------------------
// Concurrency semaphore (DoS guard)
// ---------------------------------------------------------------------------

class Semaphore {
  private permits: number
  private queue: Array<() => void> = []

  constructor(permits: number) {
    this.permits = permits
  }

  acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--
      return Promise.resolve()
    }
    return new Promise((resolve) => this.queue.push(resolve))
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!
      next()
    } else {
      this.permits++
    }
  }

  get available(): number {
    return this.permits
  }
}

let _semaphore: Semaphore | null = null

export function getCloneSemaphore(): Semaphore {
  if (!_semaphore) {
    _semaphore = new Semaphore(cloneConcurrency())
  }
  return _semaphore
}

// ---------------------------------------------------------------------------
// In-memory clone registry (for GITSEMA_CLONE_KEEP=keep)
// ---------------------------------------------------------------------------

/** Map from normalised URL → local clone path. Lost on server restart. */
const cloneRegistry = new Map<string, string>()

function normaliseUrl(rawUrl: string): string {
  if (!rawUrl.includes('://')) {
    // SCP-style: normalise to lowercase
    return rawUrl.toLowerCase()
  }
  try {
    const parsed = new URL(rawUrl)
    parsed.username = ''
    parsed.password = ''
    // Normalise trailing slash on path
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/'
    return parsed.toString().toLowerCase()
  } catch {
    return rawUrl.toLowerCase()
  }
}

// ---------------------------------------------------------------------------
// Clone execution
// ---------------------------------------------------------------------------

export interface CloneOptions {
  repoUrl: string
  credentials?: CloneCredentials
  depth?: number | null
}

export interface CloneResult {
  clonePath: string
  /** true if this was a fresh clone; false if an existing clone was fetched */
  fresh: boolean
}

/**
 * Builds the extra environment variables needed for credential delivery.
 * Returns the vars and paths to temp files that must be deleted in finally.
 */
async function buildCredentialEnv(
  credentials: CloneCredentials | undefined,
): Promise<{ extraEnv: Record<string, string>; tempFiles: string[] }> {
  const extraEnv: Record<string, string> = {}
  const tempFiles: string[] = []

  if (!credentials) return { extraEnv, tempFiles }

  if (credentials.type === 'token') {
    // Phase 17: GIT_ASKPASS keeps the token out of /proc/<pid>/cmdline
    const askpassPath = await writeAskpassScript(credentials.token)
    tempFiles.push(askpassPath)
    extraEnv['GIT_ASKPASS'] = askpassPath
    extraEnv['GIT_TERMINAL_PROMPT'] = '0' // fail fast if askpass returns nothing useful
  } else if (credentials.type === 'sshKey') {
    // Phase 17: write key to temp file, set GIT_SSH_COMMAND
    const keyPath = await writeSshKey(credentials.key)
    tempFiles.push(keyPath)
    extraEnv['GIT_SSH_COMMAND'] =
      `ssh -i ${keyPath} -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null -o BatchMode=yes`
  }

  return { extraEnv, tempFiles }
}

/**
 * Creates a unique temp directory under `cloneDir`, runs `git clone`, and
 * returns the path. Size monitoring kills the process if it exceeds the limit.
 */
async function freshClone(options: CloneOptions): Promise<string> {
  const { repoUrl, credentials, depth } = options
  const base = cloneDir()
  const clonePath = await mkdtemp(join(base, 'gitsema-'))
  const safeUrl = sanitiseUrl(repoUrl)

  const args: string[] = ['clone', '--quiet']
  if (depth != null && depth > 0) {
    args.push('--depth', String(depth))
  }
  args.push(repoUrl, clonePath)

  logger.info(`Cloning ${safeUrl} into ${clonePath}`)

  const { extraEnv, tempFiles } = await buildCredentialEnv(credentials)
  try {
    await runGitCommand(args, clonePath, safeUrl, extraEnv)
  } finally {
    for (const f of tempFiles) {
      await unlink(f).catch(() => {})
    }
  }

  return clonePath
}

/**
 * Runs `git fetch --all` in an existing clone to update it.
 */
async function updateClone(clonePath: string, options: CloneOptions): Promise<void> {
  const { repoUrl, credentials } = options
  const safeUrl = sanitiseUrl(repoUrl)
  logger.info(`Fetching updates for ${safeUrl} in ${clonePath}`)

  const { extraEnv, tempFiles } = await buildCredentialEnv(credentials)
  try {
    await runGitCommand(['fetch', '--all', '--quiet'], clonePath, safeUrl, extraEnv)
  } finally {
    for (const f of tempFiles) {
      await unlink(f).catch(() => {})
    }
  }
}

/**
 * Spawns a git command, enforcing timeout and size limits.
 * Never uses shell to avoid credential leakage.
 * Extra environment variables (e.g. GIT_ASKPASS, GIT_SSH_COMMAND) are merged
 * with the current process environment.
 */
function runGitCommand(
  args: string[],
  cwd: string,
  safeUrl: string,
  extraEnv: Record<string, string> = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const maxBytes = cloneMaxBytes()
    const timeoutMs = cloneTimeoutMs()

    const proc = spawn('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false, // critical: never use shell (credential leakage risk)
      env: { ...process.env, ...extraEnv },
    })

    let stderr = ''
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    // Wall-clock timeout
    const timeoutHandle = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(new Error(`git operation timed out after ${timeoutMs}ms for ${safeUrl}`))
    }, timeoutMs)

    // Size monitoring: poll du every 5s
    let sizeAborted = false
    const sizeHandle = setInterval(async () => {
      try {
        const { execFile } = await import('node:child_process')
        execFile('du', ['-sb', cwd], (_err, stdout) => {
          if (!stdout) return
          const bytes = parseInt(stdout.split('\t')[0] ?? '0', 10)
          if (bytes > maxBytes) {
            sizeAborted = true
            proc.kill('SIGKILL')
            reject(new Error(`Clone exceeds GITSEMA_CLONE_MAX_BYTES (${maxBytes}) for ${safeUrl}`))
          }
        })
      } catch {
        // du not available; skip size monitoring
      }
    }, 5000)

    proc.on('close', (code) => {
      clearTimeout(timeoutHandle)
      clearInterval(sizeHandle)
      if (sizeAborted) return
      if (code === 0) {
        resolve()
      } else {
        // Sanitise stderr before logging to avoid leaking credentials
        const safeSstderr = stderr.replace(/https?:\/\/[^@\s]+@/g, 'https://<credentials>@')
        reject(new Error(`git exited with code ${code} for ${safeUrl}: ${safeSstderr.trim()}`))
      }
    })

    proc.on('error', (err) => {
      clearTimeout(timeoutHandle)
      clearInterval(sizeHandle)
      reject(new Error(`Failed to spawn git for ${safeUrl}: ${err.message}`))
    })
  })
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Obtains a local clone of `repoUrl`, respecting `GITSEMA_CLONE_KEEP`:
 *  - `always` / `on-success`: always do a fresh clone
 *  - `keep`: reuse existing clone (fetch updates); create new clone if not registered
 *
 * Returns the local clone path.
 */
export async function obtainClone(options: CloneOptions): Promise<CloneResult> {
  const keep = cloneKeep()
  const key = normaliseUrl(options.repoUrl)

  if (keep === 'keep') {
    const existing = cloneRegistry.get(key)
    if (existing) {
      try {
        await updateClone(existing, options)
        return { clonePath: existing, fresh: false }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.warn(`Failed to update clone at ${existing}: ${msg}. Re-cloning.`)
        cloneRegistry.delete(key)
      }
    }
    const clonePath = await freshClone(options)
    cloneRegistry.set(key, clonePath)
    return { clonePath, fresh: true }
  }

  // always / on-success: fresh clone every time
  const clonePath = await freshClone(options)
  return { clonePath, fresh: true }
}

/**
 * Removes a clone directory according to `GITSEMA_CLONE_KEEP` strategy.
 *
 * @param clonePath - directory to remove
 * @param succeeded - whether the indexing pipeline succeeded
 */
export async function cleanupClone(clonePath: string, succeeded: boolean): Promise<void> {
  const keep = cloneKeep()

  if (keep === 'keep') {
    // Registered clones are kept indefinitely; never delete here
    return
  }

  if (keep === 'on-success' && !succeeded) {
    logger.debug(`Keeping clone at ${clonePath} (GITSEMA_CLONE_KEEP=on-success, indexing failed)`)
    return
  }

  // keep === 'always' OR (keep === 'on-success' AND succeeded)
  try {
    await rm(clonePath, { recursive: true, force: true })
    logger.debug(`Removed clone directory ${clonePath}`)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`Failed to remove clone directory ${clonePath}: ${msg}`)
  }
}
