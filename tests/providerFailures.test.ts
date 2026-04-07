/**
 * Provider failure-mode tests.
 *
 * Validates that the embedding provider stack behaves correctly under:
 *   - Total embedding failure (embed() throws)
 *   - Batch embedding failure (embedBatch() throws, falls back to embed())
 *   - Timeout-like (slow provider completes eventually)
 *   - Rate-limit response (HTTP 429 / 503 simulation via provider error)
 *   - Partial batch failure (some items fail, others succeed)
 *   - Retry + back-off in BatchingProvider
 *   - Zero-vector fallback when all retries are exhausted
 *
 * These are unit tests against the BatchingProvider class and the HTTP server
 * layer; no real network calls or embedding models are used.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { BatchingProvider } from '../src/core/embedding/batching.js'
import { createApp } from '../src/server/app.js'
import type { EmbeddingProvider } from '../src/core/embedding/provider.js'
import request from 'supertest'

afterEach(() => {
  vi.restoreAllMocks()
})

// ===========================================================================
// BatchingProvider — sub-batch chunking and retry behavior
// ===========================================================================

describe('BatchingProvider — basic pass-through', () => {
  it('delegates single embed() to inner provider', async () => {
    const inner: EmbeddingProvider = {
      model: 'inner',
      embed: vi.fn().mockResolvedValue([1, 2, 3]),
      dimensions: 3,
    }
    const provider = new BatchingProvider(inner)
    const result = await provider.embed('hello')
    expect(result).toEqual([1, 2, 3])
    expect(inner.embed).toHaveBeenCalledWith('hello')
  })

  it('returns correct model name from inner provider', () => {
    const inner: EmbeddingProvider = {
      model: 'my-model',
      embed: async () => [],
      dimensions: 4,
    }
    const provider = new BatchingProvider(inner)
    expect(provider.model).toBe('my-model')
    expect(provider.dimensions).toBe(4)
  })

  it('returns empty array for empty input', async () => {
    const inner: EmbeddingProvider = {
      model: 'inner',
      embed: vi.fn(),
      embedBatch: vi.fn().mockResolvedValue([]),
      dimensions: 4,
    }
    const provider = new BatchingProvider(inner)
    const result = await provider.embedBatch([])
    expect(result).toEqual([])
    expect(inner.embedBatch).not.toHaveBeenCalled()
  })
})

describe('BatchingProvider — sub-batch chunking', () => {
  it('splits large batch into sub-batches of maxSubBatchSize', async () => {
    const batches: string[][] = []
    const inner: EmbeddingProvider = {
      model: 'inner',
      embed: async () => [0, 0],
      embedBatch: vi.fn().mockImplementation(async (texts: string[]) => {
        batches.push(texts)
        return texts.map(() => [0.1, 0.2])
      }),
      dimensions: 2,
    }
    const provider = new BatchingProvider(inner, { maxSubBatchSize: 3 })
    const texts = ['a', 'b', 'c', 'd', 'e']
    await provider.embedBatch(texts)
    // Should have split into [a,b,c] and [d,e]
    expect(batches).toHaveLength(2)
    expect(batches[0]).toEqual(['a', 'b', 'c'])
    expect(batches[1]).toEqual(['d', 'e'])
  })

  it('handles batch of exactly maxSubBatchSize (single call)', async () => {
    let callCount = 0
    const inner: EmbeddingProvider = {
      model: 'inner',
      embed: async () => [0],
      embedBatch: vi.fn().mockImplementation(async (texts: string[]) => {
        callCount++
        return texts.map(() => [1.0])
      }),
      dimensions: 1,
    }
    const provider = new BatchingProvider(inner, { maxSubBatchSize: 4 })
    await provider.embedBatch(['a', 'b', 'c', 'd'])
    expect(callCount).toBe(1)
  })

  it('returns all embeddings in correct order after splitting', async () => {
    let counter = 0
    const inner: EmbeddingProvider = {
      model: 'inner',
      embed: async () => [0],
      embedBatch: async (texts: string[]) => texts.map(() => [++counter]),
      dimensions: 1,
    }
    const provider = new BatchingProvider(inner, { maxSubBatchSize: 2 })
    const results = await provider.embedBatch(['a', 'b', 'c', 'd'])
    // Results should be [1], [2], [3], [4] in order
    expect(results).toHaveLength(4)
    expect(results[0][0]).toBe(1)
    expect(results[1][0]).toBe(2)
    expect(results[2][0]).toBe(3)
    expect(results[3][0]).toBe(4)
  })
})

describe('BatchingProvider — retry logic', () => {
  it('retries a failing sub-batch the configured number of times', async () => {
    let attempts = 0
    const inner: EmbeddingProvider = {
      model: 'inner',
      embed: async () => [0],
      embedBatch: vi.fn().mockImplementation(async () => {
        attempts++
        throw new Error('temporary failure')
      }),
      dimensions: 1,
    }
    // retries=2 → 3 total attempts (1 initial + 2 retries), then fallback
    const provider = new BatchingProvider(inner, {
      retries: 2,
      retryDelayMs: 1,
    })
    // After all retries fail, falls back to per-item embed()
    ;(inner.embed as any) = vi.fn().mockResolvedValue([0.5])
    const results = await provider.embedBatch(['text1'])
    expect(attempts).toBe(3) // 1 + 2 retries
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual([0.5])
  })

  it('succeeds on second attempt when first fails', async () => {
    let attempts = 0
    const inner: EmbeddingProvider = {
      model: 'inner',
      embed: async () => [0],
      embedBatch: vi.fn().mockImplementation(async (texts: string[]) => {
        attempts++
        if (attempts === 1) throw new Error('transient error')
        return texts.map(() => [0.9])
      }),
      dimensions: 1,
    }
    const provider = new BatchingProvider(inner, { retries: 2, retryDelayMs: 1 })
    const results = await provider.embedBatch(['hello'])
    expect(attempts).toBe(2)
    expect(results[0]).toEqual([0.9])
  })
})

describe('BatchingProvider — zero-vector fallback', () => {
  it('returns zero vector when embed() also fails after batch failure', async () => {
    const inner: EmbeddingProvider = {
      model: 'inner',
      embed: vi.fn().mockRejectedValue(new Error('embed also failed')),
      embedBatch: vi.fn().mockRejectedValue(new Error('batch failed')),
      dimensions: 4,
    }
    const provider = new BatchingProvider(inner, { retries: 0, retryDelayMs: 0 })
    const results = await provider.embedBatch(['text'])
    // After all retries exhausted and per-item embed fails → zero vector
    expect(results).toHaveLength(1)
    expect(results[0]).toHaveLength(4)
    expect(results[0].every((v) => v === 0)).toBe(true)
  })

  it('falls back to per-item embed when embedBatch is not supported', async () => {
    // Provider without embedBatch
    const inner: EmbeddingProvider = {
      model: 'inner',
      embed: vi.fn().mockResolvedValue([1, 2]),
      dimensions: 2,
    }
    const provider = new BatchingProvider(inner, { retries: 0, retryDelayMs: 0 })
    const results = await provider.embedBatch(['a', 'b'])
    expect(results).toHaveLength(2)
    expect(results[0]).toEqual([1, 2])
    expect(results[1]).toEqual([1, 2])
    expect(inner.embed).toHaveBeenCalledTimes(2)
  })
})

describe('BatchingProvider — partial batch failure', () => {
  it('returns zero vectors only for failed items, not all', async () => {
    // embedBatch always fails; embed returns value for 'good' but fails for 'bad'
    const inner: EmbeddingProvider = {
      model: 'inner',
      embed: vi.fn().mockImplementation(async (text: string) => {
        if (text === 'bad') throw new Error('bad input')
        return [0.5, 0.5]
      }),
      embedBatch: vi.fn().mockRejectedValue(new Error('batch fail')),
      dimensions: 2,
    }
    const provider = new BatchingProvider(inner, { retries: 0, retryDelayMs: 0, maxSubBatchSize: 10 })
    const results = await provider.embedBatch(['good', 'bad'])
    expect(results).toHaveLength(2)
    expect(results[0]).toEqual([0.5, 0.5])  // good item succeeded
    expect(results[1]).toEqual([0, 0])       // bad item → zero vector
  })
})

// ===========================================================================
// HTTP server — provider failure → 502 status code
// ===========================================================================

describe('HTTP server — provider failure returns 502', () => {
  const makeFailApp = (errorMsg = 'provider unavailable') => {
    const failProvider: EmbeddingProvider = {
      model: 'fail',
      embed: async () => { throw new Error(errorMsg) },
      dimensions: 4,
    }
    return createApp({ textProvider: failProvider })
  }

  it('POST /search returns 502 when provider throws', async () => {
    const app = makeFailApp('provider unavailable')
    const res = await request(app).post('/api/v1/search').send({ query: 'auth' })
    expect(res.status).toBe(502)
    expect(res.body).toHaveProperty('error')
    expect(res.body.error).toMatch(/embed/i)
  })

  it('POST /search/first-seen returns 502 when provider throws', async () => {
    const app = makeFailApp('timeout')
    const res = await request(app)
      .post('/api/v1/search/first-seen')
      .send({ query: 'auth' })
    expect(res.status).toBe(502)
    expect(res.body).toHaveProperty('error')
  })

  it('POST /analysis/change-points returns 502 when provider throws', async () => {
    const app = makeFailApp('rate limit exceeded')
    const res = await request(app)
      .post('/api/v1/analysis/change-points')
      .send({ query: 'auth' })
    expect(res.status).toBe(502)
  })

  it('POST /evolution/concept returns 502 when provider throws', async () => {
    const app = makeFailApp('503 Service Unavailable')
    const res = await request(app)
      .post('/api/v1/evolution/concept')
      .send({ query: 'auth' })
    expect(res.status).toBe(502)
  })

  it('POST /analysis/author returns 502 when provider throws', async () => {
    const app = makeFailApp('429 Too Many Requests')
    const res = await request(app)
      .post('/api/v1/analysis/author')
      .send({ query: 'auth' })
    expect(res.status).toBe(502)
  })

  it('error message from provider is included in 502 response body', async () => {
    const errorMsg = 'specific provider error message'
    const app = makeFailApp(errorMsg)
    const res = await request(app).post('/api/v1/search').send({ query: 'auth' })
    expect(res.status).toBe(502)
    expect(res.body.error).toContain(errorMsg)
  })
})

describe('HTTP server — slow provider (timeout simulation)', () => {
  it('completes request when provider is slow but eventually succeeds', async () => {
    let resolved = false
    const slowProvider: EmbeddingProvider = {
      model: 'slow',
      embed: async () => {
        await new Promise((r) => setTimeout(r, 50))  // 50ms delay
        resolved = true
        return [0.1, 0.2, 0.3, 0.4]
      },
      dimensions: 4,
    }
    const app = createApp({ textProvider: slowProvider })
    const res = await request(app)
      .post('/api/v1/search')
      .send({ query: 'auth' })
      .timeout(5000)
    expect(res.status).toBe(200)
    expect(resolved).toBe(true)
  })
})
