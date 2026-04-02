import { describe, it, expect } from 'vitest'
import {
  splitIdentifier,
  extractRichTokens,
  computeTermFrequencies,
  computeTfIdfScores,
  enhanceClusters,
  normalizeToken,
  PROGRAMMING_NOISE_WORDS,
  TOKEN_NORMALIZATIONS,
} from '../src/core/search/labelEnhancer.js'

// ---------------------------------------------------------------------------
// splitIdentifier
// ---------------------------------------------------------------------------

describe('splitIdentifier', () => {
  it('splits camelCase identifiers', () => {
    expect(splitIdentifier('vectorSearch')).toEqual(['vector', 'search'])
  })

  it('splits PascalCase identifiers', () => {
    expect(splitIdentifier('BlobStore')).toEqual(['blob', 'store'])
  })

  it('splits snake_case identifiers', () => {
    expect(splitIdentifier('auth_middleware')).toEqual(['auth', 'middleware'])
  })

  it('splits kebab-case identifiers', () => {
    expect(splitIdentifier('build-config')).toEqual(['build', 'config'])
  })

  it('splits dot.notation identifiers', () => {
    expect(splitIdentifier('src.core.db')).toEqual(['src', 'core', 'db'])
  })

  it('handles acronyms like HTTPClient', () => {
    const parts = splitIdentifier('HTTPClient')
    expect(parts).toContain('http')
    expect(parts).toContain('client')
  })

  it('filters out single-character tokens', () => {
    const parts = splitIdentifier('a_b_c')
    expect(parts.every((p) => p.length >= 2)).toBe(true)
  })

  it('returns lowercase tokens', () => {
    const parts = splitIdentifier('VectorSearch')
    expect(parts.every((p) => p === p.toLowerCase())).toBe(true)
  })

  it('handles mixed separators', () => {
    const parts = splitIdentifier('src/core/searchUtils')
    expect(parts).toContain('search')
    expect(parts).toContain('utils')
  })

  it('returns empty array for empty input', () => {
    expect(splitIdentifier('')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// normalizeToken
// ---------------------------------------------------------------------------

describe('normalizeToken', () => {
  it('normalizes "authentication" to "auth"', () => {
    expect(normalizeToken('authentication')).toBe('auth')
  })

  it('normalizes "configuration" to "config"', () => {
    expect(normalizeToken('configuration')).toBe('config')
  })

  it('normalizes "database" to "db"', () => {
    expect(normalizeToken('database')).toBe('db')
  })

  it('normalizes "embeddings" to "embed"', () => {
    expect(normalizeToken('embeddings')).toBe('embed')
  })

  it('normalizes "chunks" to "chunk"', () => {
    expect(normalizeToken('chunks')).toBe('chunk')
  })

  it('returns token unchanged when no mapping exists', () => {
    expect(normalizeToken('foobar')).toBe('foobar')
  })

  it('normalizes "router" to "route"', () => {
    expect(normalizeToken('router')).toBe('route')
  })
})

// ---------------------------------------------------------------------------
// PROGRAMMING_NOISE_WORDS
// ---------------------------------------------------------------------------

describe('PROGRAMMING_NOISE_WORDS', () => {
  it('contains common noise words', () => {
    expect(PROGRAMMING_NOISE_WORDS.has('get')).toBe(true)
    expect(PROGRAMMING_NOISE_WORDS.has('data')).toBe(true)
    expect(PROGRAMMING_NOISE_WORDS.has('util')).toBe(true)
    expect(PROGRAMMING_NOISE_WORDS.has('index')).toBe(true)
    expect(PROGRAMMING_NOISE_WORDS.has('test')).toBe(true)
  })

  it('does not contain meaningful domain words', () => {
    expect(PROGRAMMING_NOISE_WORDS.has('auth')).toBe(false)
    expect(PROGRAMMING_NOISE_WORDS.has('search')).toBe(false)
    expect(PROGRAMMING_NOISE_WORDS.has('vector')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// extractRichTokens
// ---------------------------------------------------------------------------

describe('extractRichTokens', () => {
  it('extracts tokens from file paths', () => {
    const tokens = extractRichTokens(['src/core/vectorSearch.ts'], '')
    expect(tokens).toContain('vector')
    expect(tokens).toContain('search')
  })

  it('splits snake_case filenames', () => {
    const tokens = extractRichTokens(['src/utils/auth_middleware.ts'], '')
    expect(tokens).toContain('auth')
    expect(tokens).toContain('middleware')
  })

  it('extracts tokens from FTS content', () => {
    const tokens = extractRichTokens([], 'semantic search with cosine similarity ranking')
    expect(tokens).toContain('semantic')
    expect(tokens).toContain('cosine')
    expect(tokens).toContain('similarity')
    expect(tokens).toContain('ranking')
  })

  it('filters noise words from content', () => {
    const tokens = extractRichTokens([], 'get data from index function util')
    expect(tokens).not.toContain('get')
    expect(tokens).not.toContain('data')
    expect(tokens).not.toContain('index')
    expect(tokens).not.toContain('util')
    expect(tokens).not.toContain('function')
  })

  it('normalizes variants to canonical forms', () => {
    const tokens = extractRichTokens([], 'authentication configuration database')
    expect(tokens).toContain('auth')
    expect(tokens).toContain('config')
    expect(tokens).toContain('db')
    // original forms should not appear
    expect(tokens).not.toContain('authentication')
    expect(tokens).not.toContain('configuration')
    expect(tokens).not.toContain('database')
  })

  it('strips file extensions', () => {
    const tokens = extractRichTokens(['src/server/app.ts'], '')
    // 'ts' should not appear as a token
    expect(tokens).not.toContain('ts')
  })

  it('returns empty array for empty inputs', () => {
    expect(extractRichTokens([], '')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// computeTermFrequencies
// ---------------------------------------------------------------------------

describe('computeTermFrequencies', () => {
  it('counts term frequencies correctly', () => {
    const freqs = computeTermFrequencies(['auth', 'search', 'auth', 'vector', 'auth'])
    expect(freqs.get('auth')).toBe(3)
    expect(freqs.get('search')).toBe(1)
    expect(freqs.get('vector')).toBe(1)
  })

  it('returns empty map for empty input', () => {
    expect(computeTermFrequencies([]).size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// computeTfIdfScores
// ---------------------------------------------------------------------------

describe('computeTfIdfScores', () => {
  it('gives higher score to terms exclusive to one cluster', () => {
    const cluster1 = new Map([['auth', 5], ['search', 3]])
    const cluster2 = new Map([['search', 4], ['vector', 2]])
    const allFreqs = [cluster1, cluster2]

    const scores1 = computeTfIdfScores(cluster1, allFreqs)
    // 'auth' only appears in cluster1 → positive IDF
    expect((scores1.get('auth') ?? 0)).toBeGreaterThan(0)
    // 'search' appears in both clusters → IDF = 0, so score = 0
    expect(scores1.get('search')).toBe(0)
  })

  it('gives zero score to ubiquitous terms (appear in all clusters)', () => {
    const cluster1 = new Map([['common', 10]])
    const cluster2 = new Map([['common', 8]])
    const allFreqs = [cluster1, cluster2]

    const scores = computeTfIdfScores(cluster1, allFreqs)
    // 'common' appears in all 2 clusters → IDF = log(2/2) = 0 → score = 0
    expect(scores.get('common')).toBe(0)
  })

  it('gives positive scores to cluster-specific terms', () => {
    const cluster1 = new Map([['unique', 3]])
    const cluster2 = new Map([['other', 2]])
    const allFreqs = [cluster1, cluster2]

    const scores1 = computeTfIdfScores(cluster1, allFreqs)
    expect((scores1.get('unique') ?? 0)).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// enhanceClusters (main entry point)
// ---------------------------------------------------------------------------

describe('enhanceClusters', () => {
  it('returns empty keywords when disabled', () => {
    const inputs = [
      { paths: ['src/auth/login.ts'], content: 'authentication token JWT', existingKeywords: ['token'] },
      { paths: ['src/search/vector.ts'], content: 'semantic search cosine', existingKeywords: ['search'] },
    ]
    const results = enhanceClusters(inputs, { enabled: false })
    expect(results.every((r) => r.keywords.length === 0)).toBe(true)
  })

  it('returns one result per input cluster', () => {
    const inputs = [
      { paths: ['src/auth.ts'], content: 'login token', existingKeywords: [] },
      { paths: ['src/search.ts'], content: 'vector similarity', existingKeywords: [] },
      { paths: ['src/db.ts'], content: 'schema migration', existingKeywords: [] },
    ]
    const results = enhanceClusters(inputs)
    expect(results.length).toBe(3)
  })

  it('returns empty results for empty input', () => {
    expect(enhanceClusters([])).toEqual([])
  })

  it('produces distinctive keywords that differ between clusters', () => {
    const inputs = [
      {
        paths: ['src/auth/jwt.ts', 'src/auth/session.ts'],
        content: 'authentication authorize token session login logout',
        existingKeywords: ['token'],
      },
      {
        paths: ['src/search/vector.ts', 'src/search/hybrid.ts'],
        content: 'semantic search vector cosine similarity ranking bm25',
        existingKeywords: ['search'],
      },
    ]
    const results = enhanceClusters(inputs, { topN: 5 })

    // Each cluster should have at least some distinct keywords
    expect(results[0].keywords.length).toBeGreaterThan(0)
    expect(results[1].keywords.length).toBeGreaterThan(0)

    // The keyword sets should differ between clusters
    const set0 = new Set(results[0].keywords)
    const set1 = new Set(results[1].keywords)
    const intersection = [...set0].filter((k) => set1.has(k))
    // Terms appearing in both clusters score 0 and are filtered out,
    // so the intersection of enhanced keywords should be small or empty
    expect(intersection.length).toBeLessThan(Math.min(set0.size, set1.size))
  })

  it('respects topN option', () => {
    const inputs = [
      { paths: ['src/a.ts'], content: 'alpha beta gamma delta epsilon zeta eta', existingKeywords: [] },
      { paths: ['src/b.ts'], content: 'omega psi chi phi upsilon tau sigma', existingKeywords: [] },
    ]
    const results = enhanceClusters(inputs, { topN: 3 })
    for (const r of results) {
      expect(r.keywords.length).toBeLessThanOrEqual(3)
    }
  })

  it('produces deterministic results (same input → same output)', () => {
    const inputs = [
      { paths: ['src/core/clustering.ts'], content: 'cluster centroid assignment vector', existingKeywords: [] },
      { paths: ['src/core/search.ts'], content: 'query similarity cosine score', existingKeywords: [] },
    ]
    const r1 = enhanceClusters(inputs)
    const r2 = enhanceClusters(inputs)
    expect(r1).toEqual(r2)
  })

  it('TOKEN_NORMALIZATIONS covers expected variants', () => {
    expect(TOKEN_NORMALIZATIONS.has('authentication')).toBe(true)
    expect(TOKEN_NORMALIZATIONS.has('configuration')).toBe(true)
    expect(TOKEN_NORMALIZATIONS.has('database')).toBe(true)
    expect(TOKEN_NORMALIZATIONS.has('embeddings')).toBe(true)
  })
})
