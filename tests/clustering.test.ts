import { describe, it, expect } from 'vitest'
import { kMeansInit, assignClusters, updateCentroids, extractKeywords } from '../src/core/search/clustering.js'

describe('kMeansInit', () => {
  it('returns k centroids drawn from the input set', () => {
    const vectors = [[0,0],[10,10],[0,1],[9,9]]
    const centroids = kMeansInit(vectors, 2)
    expect(centroids.length).toBe(2)
    for (const c of centroids) {
      const found = vectors.some((v) => v.length === c.length && v.every((x, i) => x === c[i]))
      expect(found).toBe(true)
    }
  })
})

describe('assignClusters', () => {
  it('assigns nearest centroid indices', () => {
    const centroids = [[0,0],[10,10]]
    const vectors = [[0,0],[1,1],[9,9]]
    const a = assignClusters(vectors, centroids)
    expect(a).toEqual([0,0,1])
  })
})

describe('updateCentroids', () => {
  it('computes mean of assigned vectors', () => {
    const vectors = [[0,0],[2,2],[10,10]]
    const assignments = [0,0,1]
    const centroids = updateCentroids(vectors, assignments, 2)
    expect(centroids.length).toBe(2)
    expect(centroids[0][0]).toBeCloseTo(1)
    expect(centroids[0][1]).toBeCloseTo(1)
    expect(centroids[1][0]).toBeCloseTo(10)
  })
})

describe('extractKeywords', () => {
  it('extracts top keywords and filters stop-words and short tokens', () => {
    const text = 'This is a simple test. The test checks token extraction: authentication, auth, token, token.'
    const keywords = extractKeywords(text, 3)
    // 'token' should be present and 'auth'/'authentication' appear
    expect(keywords).toContain('token')
    // stop-word 'the' should not be present
    expect(keywords).not.toContain('the')
    // tokens shorter than 3 should be filtered
    expect(keywords.some((k) => k.length < 3)).toBe(false)
  })
})
