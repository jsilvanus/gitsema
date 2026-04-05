/**
 * Hook manager — installs and uninstalls the gitsema Git hook scripts.
 *
 * When `hooks.enabled` is set to `true` via `gitsema config`, the hook scripts
 * from `scripts/hooks/` are symlinked into the repository's `.git/hooks/`
 * directory.  When set to `false` they are removed.
 *
 * The canonical hook scripts live at `scripts/hooks/post-commit` and
 * `scripts/hooks/post-merge` relative to the gitsema package root
 * (i.e. the directory that contains `package.json`).
 */

import { chmodSync, existsSync, lstatSync, mkdirSync, rmSync, symlinkSync, type Stats } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'

/** Hook file names that gitsema manages. */
const MANAGED_HOOKS = ['post-commit', 'post-merge'] as const

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolves the absolute path to the gitsema package root by locating
 * `package.json` via `import.meta.url` (ESM) or require.resolve fallback.
 */
function getPackageRoot(): string {
  // __filename equivalent in ESM
  const requireFn = createRequire(import.meta.url)
  // Resolve the package.json of gitsema itself
  try {
    const pkgPath = requireFn.resolve('../../package.json')
    return dirname(pkgPath)
  } catch {
    // Fallback: walk up from this file's location
    // This file lives at src/core/config/hookManager.ts → package root is ../../../
    const thisFile = new URL(import.meta.url).pathname
    return resolve(dirname(thisFile), '..', '..', '..')
  }
}

/**
 * Finds the `.git` directory for the repository at `cwd`.
 * Returns `null` when not inside a Git repository.
 */
function findGitDir(cwd: string): string | null {
  try {
    const raw = execSync('git rev-parse --git-dir', {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    // `git rev-parse --git-dir` returns an absolute or relative path
    return resolve(cwd, raw)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface HookInstallResult {
  installed: string[]
  skipped: string[]
  removed: string[]
  errors: string[]
}

/**
 * Installs gitsema's Git hooks into `.git/hooks/` of the repository at `cwd`.
 *
 * For each managed hook the function:
 *   1. Resolves the source script from `<packageRoot>/scripts/hooks/<hook>`.
 *   2. Creates a symlink at `<gitDir>/hooks/<hook>` pointing to the source.
 *   3. Ensures the source script is executable (chmod +x).
 *
 * If a hook file already exists and is **not** a symlink managed by gitsema,
 * it is left untouched and recorded in `skipped`.
 */
export function installHooks(cwd: string = process.cwd()): HookInstallResult {
  const result: HookInstallResult = { installed: [], skipped: [], removed: [], errors: [] }

  const gitDir = findGitDir(cwd)
  if (!gitDir) {
    result.errors.push('Not inside a Git repository — cannot install hooks.')
    return result
  }

  const hooksDir = join(gitDir, 'hooks')
  mkdirSync(hooksDir, { recursive: true })

  const packageRoot = getPackageRoot()

  for (const hook of MANAGED_HOOKS) {
    const src = join(packageRoot, 'scripts', 'hooks', hook)
    const dest = join(hooksDir, hook)

    if (!existsSync(src)) {
      result.errors.push(`Source hook script not found: ${src}`)
      continue
    }

    // Ensure the source script is executable
    try {
      chmodSync(src, 0o755)
    } catch {
      // Non-fatal — may already be executable
    }

    const destStat = lstatSync_safe(dest)
    if (destStat !== null) {
      // If it's already a symlink, skip silently
      if (destStat.isSymbolicLink()) {
        result.skipped.push(hook)
        continue
      }
      // A non-symlink file exists; leave it untouched
      result.skipped.push(hook)
      continue
    }

    try {
      symlinkSync(src, dest)
      result.installed.push(hook)
    } catch (err) {
      result.errors.push(`Failed to install ${hook}: ${(err as Error).message}`)
    }
  }

  return result
}

/**
 * Removes gitsema-managed Git hooks from `.git/hooks/` of the repository at `cwd`.
 *
 * Only removes files that are symlinks; if a hook was manually copied (not
 * symlinked), it is left untouched and recorded in `skipped`.
 */
export function uninstallHooks(cwd: string = process.cwd()): HookInstallResult {
  const result: HookInstallResult = { installed: [], skipped: [], removed: [], errors: [] }

  const gitDir = findGitDir(cwd)
  if (!gitDir) {
    result.errors.push('Not inside a Git repository — cannot remove hooks.')
    return result
  }

  const hooksDir = join(gitDir, 'hooks')

  for (const hook of MANAGED_HOOKS) {
    const dest = join(hooksDir, hook)

    const destStat = lstatSync_safe(dest)
    if (destStat === null) {
      // Hook doesn't exist — nothing to do
      continue
    }

    try {
      if (destStat.isSymbolicLink()) {
        rmSync(dest)
        result.removed.push(hook)
      } else {
        result.skipped.push(hook)
      }
    } catch (err) {
      result.errors.push(`Failed to remove ${hook}: ${(err as Error).message}`)
    }
  }

  return result
}

/** lstat that returns null instead of throwing when the path doesn't exist. */
function lstatSync_safe(p: string): Stats | null {
  try {
    return lstatSync(p)
  } catch {
    return null
  }
}
