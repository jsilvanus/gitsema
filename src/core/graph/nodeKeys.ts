/**
 * Node-key helpers and import-path resolution for the linking pass
 * (Phase 107, knowledge-graph §2.3/§4).
 */

import { dirname, posix } from 'node:path'

/** `file:<path>`, optionally namespaced by `repoId`. */
export function fileNodeKey(path: string, repoId?: string): string {
  return `file:${repoId ? `${repoId}/${path}` : path}`
}

/** `symbol:<path>#<qualifiedName>#<signatureHash>`, optionally namespaced by `repoId`. */
export function symbolNodeKey(path: string, qualifiedName: string, signatureHash: string, repoId?: string): string {
  const p = repoId ? `${repoId}/${path}` : path
  return `symbol:${p}#${qualifiedName}#${signatureHash}`
}

/** `external:<name>` — unresolved / third-party targets. */
export function externalNodeKey(name: string): string {
  return `external:${name}`
}

/** The last segment of a dot-separated qualified name (e.g. "Auth.validateToken" -> "validateToken"). */
export function lastSegment(qualifiedName: string): string {
  const idx = qualifiedName.lastIndexOf('.')
  return idx === -1 ? qualifiedName : qualifiedName.slice(idx + 1)
}

/** Normalizes a posix-style path: collapses `.`/`..` segments, no leading `./`. */
function normalizePath(p: string): string {
  let norm = posix.normalize(p)
  if (norm.startsWith('./')) norm = norm.slice(2)
  return norm
}

/**
 * Resolves an import/module specifier (`targetModule` from a `structural_refs`
 * row, or the raw target if no module specifier was recorded) seen from
 * `sourcePath` to one of the repo's known file paths.
 *
 * - Relative specifiers (`./foo`, `../bar`) are resolved against the
 *   directory of `sourcePath`, trying common TS/JS/Python extensions and
 *   index/`__init__` files.
 * - Dotted absolute specifiers (Python: `pkg.utils`) are tried as
 *   slash-joined paths with the same extension/`__init__` candidates.
 * - Bare specifiers (npm packages, stdlib modules) are left unresolved
 *   (the caller mints an `external` node).
 *
 * Returns `undefined` if no candidate is a known path.
 */
export function resolveImportPath(sourcePath: string, targetModule: string | undefined, knownPaths: ReadonlySet<string>): string | undefined {
  if (!targetModule) return undefined

  let base: string
  if (targetModule.startsWith('.')) {
    base = normalizePath(posix.join(dirname(sourcePath), targetModule))
  } else if (targetModule.includes('.') && /^[\w.]+$/.test(targetModule)) {
    // Dotted absolute module specifier (Python): pkg.utils -> pkg/utils
    base = targetModule.replace(/\./g, '/')
  } else {
    return undefined
  }

  const candidates = [
    base,
    `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}.py`,
    `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`, `${base}/index.jsx`,
    `${base}/__init__.py`,
  ]
  for (const c of candidates) {
    if (knownPaths.has(c)) return c
  }
  return undefined
}

/**
 * Directory "distance" between two file paths — the number of segments that
 * must be removed/added to go from one directory to the other. Used to break
 * ties between ambiguous same-name resolution candidates (knowledge-graph
 * §4 tier 4): the candidate in the nearest directory wins.
 */
export function pathDistance(a: string, b: string): number {
  const da = dirname(a).split('/')
  const db = dirname(b).split('/')
  let common = 0
  while (common < da.length && common < db.length && da[common] === db[common]) common++
  return (da.length - common) + (db.length - common)
}
