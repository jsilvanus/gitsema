// ---------------------------------------------------------------------------
// Label Enhancer — Phase 24
//
// Provides richer keyword extraction for cluster labels by:
//  1. Splitting compound identifiers (camelCase, snake_case, kebab-case, etc.)
//  2. Filtering generic programming noise words
//  3. Normalizing synonymous terms to canonical forms
//  4. Ranking tokens by TF-IDF across clusters for distinctiveness-aware labeling
// ---------------------------------------------------------------------------

export interface EnhancedLabelOptions {
  enabled?: boolean
  topN?: number
}

export interface EnhancedLabelResult {
  keywords: string[]
}

export interface ClusterEnhancerInput {
  paths: string[]
  content: string
  existingKeywords: string[]
}

export function splitIdentifier(token: string): string[] {
  const parts = token.split(/[-_./\\]+/).filter(Boolean)

  const result: string[] = []
  for (const part of parts) {
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

export const PROGRAMMING_NOISE_WORDS: ReadonlySet<string> = new Set([
  'get', 'set', 'add', 'run', 'use', 'put', 'has', 'map', 'key', 'val',
  'data', 'info', 'item', 'list', 'type', 'value', 'result', 'output', 'input',
  'node', 'name', 'size', 'ids',
  'util', 'utils', 'helper', 'helpers', 'manager', 'handler', 'handlers',
  'index', 'main', 'base', 'common', 'shared', 'core', 'lib', 'app', 'bin',
  'src', 'pkg', 'mod', 'ext',
  'test', 'tests', 'spec', 'mock', 'stub', 'fixture', 'suite',
  'module', 'class', 'func', 'function', 'method', 'impl',
  'object', 'struct', 'enum', 'const', 'let', 'var',
  'string', 'number', 'boolean', 'array', 'int', 'bool', 'str',
  'true', 'false', 'null', 'none', 'undefined',
  'return', 'export', 'import', 'from', 'async', 'await', 'then', 'catch',
  'new', 'create', 'build', 'make', 'init', 'setup',
  'props', 'opts', 'args', 'options', 'params', 'param', 'ctx',
  'error', 'err', 'msg', 'message',
  'file', 'files', 'path', 'paths', 'dir', 'dirs', 'read', 'write',
])

export const TOKEN_NORMALIZATIONS: ReadonlyMap<string, string> = new Map([
  ['authentication', 'auth'],
  ['authenticate', 'auth'],
  ['authenticated', 'auth'],
  ['authenticating', 'auth'],
  ['authorize', 'auth'],
  ['authorization', 'auth'],
  ['authorized', 'auth'],
  ['configuration', 'config'],
  ['configure', 'config'],
  ['configured', 'config'],
  ['configuring', 'config'],
  ['configs', 'config'],
  ['database', 'db'],
  ['databases', 'db'],
  ['repository', 'repo'],
  ['repositories', 'repo'],
  ['servers', 'server'],
  ['services', 'service'],
  ['embeddings', 'embed'],
  ['embedding', 'embed'],
  ['embedded', 'embed'],
  ['indexing', 'index'],
  ['indexed', 'index'],
  ['indexer', 'index'],
  ['searching', 'search'],
  ['searcher', 'search'],
  ['chunks', 'chunk'],
  ['chunking', 'chunk'],
  ['chunked', 'chunk'],
  ['clustering', 'cluster'],
  ['clusters', 'cluster'],
  ['clustered', 'cluster'],
  ['queries', 'query'],
  ['querying', 'query'],
  ['commits', 'commit'],
  ['committing', 'commit'],
  ['caching', 'cache'],
  ['cached', 'cache'],
  ['vectors', 'vector'],
  ['routing', 'route'],
  ['router', 'route'],
  ['routes', 'route'],
  ['storage', 'store'],
  ['storing', 'store'],
  ['stored', 'store'],
  ['parsing', 'parse'],
  ['parser', 'parse'],
  ['parsed', 'parse'],
  ['schemas', 'schema'],
])

export function normalizeToken(token: string): string {
  return (TOKEN_NORMALIZATIONS as Map<string, string>).get(token) ?? token
}

export function extractRichTokens(paths: string[], content: string): string[] {
  const all: string[] = []

  for (const p of paths) {
    const normalized = p.replace(/\\/g, '/').replace(/^\.?\//, '')
    const parts = normalized.split('/')
    for (const part of parts) {
      const stem = part.replace(/\.[^.]+$/, '')
      all.push(...splitIdentifier(stem))
    }
  }

  const rawTokens = content.split(/\W+/).filter(Boolean)
  for (const t of rawTokens) {
    if (t.length < 2) continue
    all.push(...splitIdentifier(t))
  }

  return all
    .map(normalizeToken)
    .filter((t) => t.length >= 2 && !(PROGRAMMING_NOISE_WORDS as Set<string>).has(t))
}

export function computeTermFrequencies(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>()
  for (const t of tokens) {
    freq.set(t, (freq.get(t) ?? 0) + 1)
  }
  return freq
}

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

export function enhanceClusters(
  inputs: ClusterEnhancerInput[],
  opts: EnhancedLabelOptions = {},
): EnhancedLabelResult[] {
  const enabled = opts.enabled !== false
  const topN = opts.topN ?? 5

  if (!enabled || inputs.length === 0) {
    return inputs.map(() => ({ keywords: [] }))
  }

  const clusterTokens: string[][] = inputs.map((inp) =>
    extractRichTokens(inp.paths, inp.content),
  )

  const clusterFreqs: Map<string, number>[] = clusterTokens.map(computeTermFrequencies)

  return clusterFreqs.map((freq) => {
    const scores = computeTfIdfScores(freq, clusterFreqs)

    const sorted = Array.from(scores.entries())
      .filter(([, score]) => score > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))

    const keywords = sorted.slice(0, topN).map(([term]) => term)
    return { keywords }
  })
}
