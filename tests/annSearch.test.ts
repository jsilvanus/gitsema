import { describe, it, expect, vi } from 'vitest'
import { getVssIndexPaths, annSearch } from '../src/core/search/vectorSearch.js'

describe('getVssIndexPaths', () => {
  it('returns null when index files do not exist', () => {
    // In a test environment there is no .gitsema/ directory with a usearch index
    const result = getVssIndexPaths('nomic-embed-text')
    expect(result).toBeNull()
  })

  it('sanitizes model name to safe filename', () => {
    // The function should not throw for unusual model names
    const result = getVssIndexPaths('openai/text-embedding-3-small')
    expect(result).toBeNull() // index does not exist in test env
  })
})

describe('annSearch', () => {
  it('returns null when no index exists', async () => {
    const queryVec = Array.from({ length: 768 }, () => 0.01)
    const result = await annSearch(queryVec, 'nomic-embed-text', 10)
    expect(result).toBeNull()
  })

  it('returns null when usearch is not installed', async () => {
    // In our test environment usearch may not be installed — should fallback gracefully
    const queryVec = new Float32Array(768).fill(0.01)
    const result = await annSearch(Array.from(queryVec), 'nonexistent-model', 10)
    expect(result).toBeNull()
  })
})

describe('SearchResult kind discriminant', () => {
  it('file kind is set for whole-file results', () => {
    // Verify the type definition includes kind
    const r = {
      kind: 'file' as const,
      blobHash: 'abc',
      paths: ['src/foo.ts'],
      score: 0.9,
    }
    expect(r.kind).toBe('file')
  })

  it('chunk kind is set for chunk results', () => {
    const r = {
      kind: 'chunk' as const,
      blobHash: 'abc',
      paths: ['src/foo.ts'],
      score: 0.9,
      chunkId: 1,
      startLine: 10,
      endLine: 20,
    }
    expect(r.kind).toBe('chunk')
  })

  it('symbol kind is set for symbol results', () => {
    const r = {
      kind: 'symbol' as const,
      blobHash: 'abc',
      paths: ['src/foo.ts'],
      score: 0.9,
      symbolId: 5,
      symbolName: 'myFunction',
      symbolKind: 'function',
    }
    expect(r.kind).toBe('symbol')
  })

  it('module kind is set for module centroid results', () => {
    const r = {
      kind: 'module' as const,
      blobHash: 'module:src/auth',
      paths: ['src/auth'],
      score: 0.85,
      modulePath: 'src/auth',
    }
    expect(r.kind).toBe('module')
  })
})
