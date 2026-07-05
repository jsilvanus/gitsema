/**
 * Shared validation for user-supplied git refspecs.
 *
 * These helpers are intentionally conservative: they only allow characters that
 * are legal in standard git revision syntax and reject values that begin with
 * `-`, which `git` would otherwise treat as a flag.
 */

export function isSafeGitRange(range: string): boolean {
  return /^[A-Za-z0-9._/~^@{}][A-Za-z0-9._/~^@{}-]*$/.test(range)
}
