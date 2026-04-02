// ---------------------------------------------------------------------------
// Label Enhancer — Phase 24
//
// Provides richer keyword extraction for cluster labels by:
//  1. Splitting compound identifiers (camelCase, snake_case, kebab-case, etc.)
//  2. Filtering generic programming noise words
//  3. Normalizing synonymous terms to canonical forms
//  4. Ranking tokens by TF-IDF across clusters for distinctiveness-aware labeling
// ---------------------------------------------------------------------------

/**
 * Options for cluster label enhancement.
 */
export interface EnhancedLabelOptions {
  /** Whether to enable label enhancement (default: true) */
  enabled?: boolean
  /** Maximum number of enhanced keywords to return per cluster (default: 5) */
  topN?: number
}

/**
 * Enhanced labeling result for a single cluster.
 */
export interface EnhancedLabelResult {
  /** TF-IDF ranked keywords, noise-filtered and normalized */
  keywords: string[]
}

/**
 * Input for a single cluster passed to `enhanceClusters`.
 */
export interface ClusterEnhancerInput {
  /** Representative file paths for this cluster */
  paths: string[]
  /** Combined FTS content for this cluster */
  content: string
  /** Existing keyword labels (from the base extractor) */
  existingKeywords: string[]
}

// ---------------------------------------------------------------------------
// Identifier splitting
// ---------------------------------------------------------------------------

/**
 * Splits a compound identifier into constituent lower-case words.
 * Handles: camelCase, PascalCase, snake_case, kebab-case, dot.notation,
 *          slash-separated paths, and acronyms (e.g. HTTPClient → http client).
 *
 * Examples:
 *   "vectorSearch"   → ["vector", "search"]
 *   "BlobStore"      → ["blob", "store"]
 *   "auth_middleware" → ["auth", "middleware"]
 *   "build-config"   → ["build", "config"]
 *   "src.core.db"    → ["src", "core", "db"]
 *   "HTTPClient"     → ["http", "client"]
 *
 * @param token The compound identifier to split.
 * @returns Array of lower-case constituent words (length ≥ 2).
 */
export function splitIdentifier(token: string): string[] {
  // Split on explicit non-alphanumeric separators first
  const parts = token.split(/[-_./\\]+/).filter(Boolean)

  const result: string[] = []
  for (const part of parts) {
    // Insert boundary before an uppercase letter that follows a lowercase/digit
    // (handles camelCase: "vectorSearch" → "vector Search")
    // Then insert boundary between a run of uppercase letters and a trailing
    // uppercase+lowercase pair (handles acronyms: "HTTPClient" → "HTTP Client")
    const subParts = part
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .split(' ')
      .filter(Boolean)
    result.push(...subParts)
  }

  return result
    .map((s) => s.toLowerCase())
    .filter((s) => s.length >= 2)
}

// ---------------------------------------------------------------------------
// Noise words (generic programming terms that add little value to labels)
// ---------------------------------------------------------------------------

/**
 * Generic programming terms that are not informative for cluster labels.
 * These are filtered out after splitting and normalization.
 */
export const PROGRAMMING_NOISE_WORDS: ReadonlySet<string> = new Set([
  // Very short / generic verbs
  'get', 'set', 'add', 'run', 'use', 'put', 'has', 'map', 'key', 'val',
  // Generic nouns
  'data', 'info', 'item', 'list', 'type', 'value', 'result', 'output', 'input',
  'node', 'name', 'size', 'ids',
  // Structural / boilerplate
  'util', 'utils', 'helper', 'helpers', 'manager', 'handler', 'handlers',
  'index', 'main', 'base', 'common', 'shared', 'core', 'lib', 'app', 'bin',
  'src', 'pkg', 'mod', 'ext',
  // Test-related
  'test', 'tests', 'spec', 'mock', 'stub', 'fixture', 'suite',
  // Language construct terms
  'module', 'class', 'func', 'function', 'method', 'impl',
  'object', 'struct', 'enum', 'const', 'let', 'var',
  'string', 'number', 'boolean', 'array', 'int', 'bool', 'str',
  'true', 'false', 'null', 'none', 'undefined',
  // Flow / keywords
  'return', 'export', 'import', 'from', 'async', 'await', 'then', 'catch',
  'new', 'create', 'build', 'make', 'init', 'setup',
  // Common parameter names
  'props', 'opts', 'args', 'options', 'params', 'param', 'ctx',
  // Error terms
  'error', 'err', 'msg', 'message',
  // File system
  'file', 'files', 'path', 'paths', 'dir', 'dirs', 'read', 'write',
])

// ---------------------------------------------------------------------------
// Token normalization
// ---------------------------------------------------------------------------

/**
 * Maps verbose or variant terms to their canonical short forms.
 * Applied after identifier splitting, before noise filtering.
 */
export const TOKEN_NORMALIZATIONS: ReadonlyMap<string, string> = new Map([
  // Auth
  ['authentication', 'auth'],
  ['authenticate', 'auth'],
  ['authenticated', 'auth'],
  ['authenticating', 'auth'],
  ['authorize', 'auth'],
  ['authorization', 'auth'],
  ['authorized', 'auth'],
  // Config
  ['configuration', 'config'],
  ['configure', 'config'],
  ['configured', 'config'],
  ['configuring', 'config'],
  ['configs', 'config'],
  // Database
  ['database', 'db'],
  ['databases', 'db'],
  // Repository
  ['repository', 'repo'],
  ['repositories', 'repo'],
  // Server / service
  ['servers', 'server'],
  ['services', 'service'],
  // Embedding
  ['embeddings', 'embed'],
  ['embedding', 'embed'],
  ['embedded', 'embed'],
  // Index
  ['indexing', 'index'],
  ['indexed', 'index'],
  ['indexer', 'index'],
  // Search
  ['searching', 'search'],
  ['searcher', 'search'],
  // Chunk
  ['chunking', 'chunk'],
  ['chunker', 'chunk'],
  ['chunks', 'chunk'],
  // Cluster
  ['clustering', 'cluster'],
  ['clusters', 'cluster'],
  ['clustered', 'cluster'],
  // Query
  ['queries', 'query'],
  ['querying', 'query'],
  // Commit
  ['commits', 'commit'],
  ['committing', 'commit'],
  // Cache
  ['caching', 'cache'],
  ['cached', 'cache'],
  // Vector
  ['vectors', 'vector'],
  // Route
  ['routing', 'route'],
  ['router', 'route'],
  ['routes', 'route'],
  // Store / storage
  ['storage', 'store'],
  ['storing', 'store'],
  ['stored', 'store'],
  // Parse
  ['parsing', 'parse'],
  ['parser', 'parse'],
  ['parsed', 'parse'],
  // Schema
  ['schemas', 'schema'],
])

/**
 * Normalizes a single token using the normalization map.
 * Returns the canonical form when a mapping exists, or the token unchanged.
 *
 * @param token The lower-case token to normalize.
 * @returns The canonical form of the token, or the original if no mapping exists.
 */
export function normalizeToken(token: string): string {
  return (TOKEN_NORMALIZATIONS as Map<string, string>).get(token) ?? token
}

// ---------------------------------------------------------------------------
// Rich token extraction
// ---------------------------------------------------------------------------

/**
 * Extracts, splits, normalizes, and de-noises tokens from file paths and FTS
 * content.
 *
 * For paths: each directory component and filename stem is split using
 * `splitIdentifier` so that e.g. `src/core/vectorSearch.ts` contributes
 * "vector" and "search" (beyond the plain path prefix).
 *
 * For content: raw words are split on non-word chars, then each token is
 * further split as a compound identifier, normalized, and noise-filtered.
 *
 * @param paths   File paths associated with blobs in the cluster.
 * @param content Combined FTS text content for all blobs in the cluster.
 * @returns       Deduplicated stream of meaningful, normalized lower-case tokens.
 */
export function extractRichTokens(paths: string[], content: string): string[] {
  const all: string[] = []

  // --- Path tokens ---
  for (const p of paths) {
    // Normalize path separators and strip leading slashes
    const normalized = p.replace(/\\/g, '/').replace(/^\.?\//, '')
    const parts = normalized.split('/')
    for (const part of parts) {
      // Strip file extension for the final component
      const stem = part.replace(/\.[^.]+$/, '')
      all.push(...splitIdentifier(stem))
    }
  }

  // --- Content tokens ---
  const rawTokens = content.split(/\W+/).filter(Boolean)
  for (const t of rawTokens) {
    if (t.length < 2) continue
    all.push(...splitIdentifier(t))
  }

  // Normalize and filter noise
  return all
    .map(normalizeToken)
    .filter((t) => t.length >= 2 && !(PROGRAMMING_NOISE_WORDS as Set<string>).has(t))
}

// ---------------------------------------------------------------------------
// Term frequency computation
// ---------------------------------------------------------------------------

/**
 * Counts the frequency of each token in the given list.
 * Assumes tokens are already normalized and filtered.
 *
 * @param tokens Pre-processed token list (normalized, noise-filtered).
 * @returns Map from token to its raw occurrence count.
 */
export function computeTermFrequencies(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>()
  for (const t of tokens) {
    freq.set(t, (freq.get(t) ?? 0) + 1)
  }
  return freq
}

// ---------------------------------------------------------------------------
// TF-IDF scoring
// ---------------------------------------------------------------------------

/**
 * Computes TF-IDF scores for terms in a single cluster relative to all
 * clusters.
 *
 * - TF  = raw count for the term in this cluster.
 * - IDF = log(totalClusters / clustersContainingTerm)
 *         (terms present in every cluster receive IDF=0 and are excluded from
 *          results by the caller; terms present in only one cluster get the
 *          maximum IDF of log(N); division by zero cannot occur because
 *          docFreq ≥ 1 for every term iterated — the current cluster itself
 *          always contributes at least one count).
 *
 * @param clusterFreqs  Term frequencies for the cluster being scored.
 * @param allFreqs      Term frequencies for every cluster (including this one).
 * @returns             Map<term, tfidf_score> for every term in clusterFreqs.
 */
export function computeTfIdfScores(
  clusterFreqs: Map<string, number>,
  allFreqs: ReadonlyArray<Map<string, number>>,
): Map<string, number> {
  const totalClusters = allFreqs.length
  const scores = new Map<string, number>()

  for (const [term, tf] of clusterFreqs.entries()) {
    let docFreq = 0
    for (const freq of allFreqs) {
      if (freq.has(term)) docFreq++
    }
    const idf = Math.log(totalClusters / docFreq)
    scores.set(term, tf * idf)
  }

  return scores
}

// ---------------------------------------------------------------------------
// Main enhancer — operates over ALL clusters at once (needed for IDF)
// ---------------------------------------------------------------------------

/**
 * Computes enhanced keyword lists for all clusters using path-aware token
 * extraction and TF-IDF cross-cluster ranking.
 *
 * The returned array has one `EnhancedLabelResult` per input cluster, in the
 * same order as `inputs`.
 *
 * Results are deterministic: same inputs always produce the same outputs
 * (ties broken alphabetically).
 *
 * @param inputs  Per-cluster input data (paths, FTS content, existing keywords).
 * @param opts    Tuning options (enabled, topN).
 */
export function enhanceClusters(
  inputs: ClusterEnhancerInput[],
  opts: EnhancedLabelOptions = {},
): EnhancedLabelResult[] {
  const enabled = opts.enabled !== false // default: true
  const topN = opts.topN ?? 5

  if (!enabled || inputs.length === 0) {
    return inputs.map(() => ({ keywords: [] }))
  }

  // Step 1: Extract rich tokens for each cluster
  const clusterTokens: string[][] = inputs.map((inp) =>
    extractRichTokens(inp.paths, inp.content),
  )

  // Step 2: Compute per-cluster term frequencies
  const clusterFreqs: Map<string, number>[] = clusterTokens.map(computeTermFrequencies)

  // Step 3: Compute TF-IDF scores for each cluster and pick top N
  return clusterFreqs.map((freq) => {
    const scores = computeTfIdfScores(freq, clusterFreqs)

    // Keep only terms with a positive score (IDF > 0, i.e. not in every cluster)
    // Sort descending by score, then alphabetically for determinism
    const sorted = Array.from(scores.entries())
      .filter(([, score]) => score > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))

    const keywords = sorted.slice(0, topN).map(([term]) => term)
    return { keywords }
  })
}
