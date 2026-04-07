/**
 * Phase 62 tests — Heavy Batching for Ollama + HTTP providers.
 *
 * Tests:
 *  - BatchingProvider: sub-batch chunking, retry on failure, per-item fallback
 *  - OllamaProvider: true /api/embed batch endpoint, 404 fallback to serial
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { BatchingProvider } from '../src/core/embedding/batching.js'
import { OllamaProvider } from '../src/core/embedding/local.js'
import type { EmbeddingProvider } from '../src/core/embedding/provider.js'

afterEach(() => {
  vi.restoreAllMocks()
})

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function makeInner(overrides: Partial<EmbeddingProvider> = {}): EmbeddingProvider {
  return {
    model: 'test-model',
    dimensions: 4,
    embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3, 0.4]),
    embedBatch: vi.fn().mockImplementation((texts: string[]) =>
      Promise.resolve(texts.map((_, i) => [i * 0.1, 0.2, 0.3, 0.4])),
    ),
    ...overrides,
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// BatchingProvider
// ──────────────────────────────────────────────────────────────────────────────

describe('BatchingProvider', () => {
  it('passes through dimensions and model from inner provider', () => {
    const inner = makeInner()
    const bp = new BatchingProvider(inner, { maxSubBatchSize: 10 })
    expect(bp.model).toBe('test-model')
    expect(bp.dimensions).toBe(4)
  })

  it('delegates single embed() to inner provider', async () => {
    const inner = makeInner()
    const bp = new BatchingProvider(inner)
    const result = await bp.embed('hello')
    expect(inner.embed).toHaveBeenCalledWith('hello')
    expect(result).toEqual([0.1, 0.2, 0.3, 0.4])
  })

  it('returns empty array for empty input', async () => {
    const inner = makeInner()
    const bp = new BatchingProvider(inner)
    expect(await bp.embedBatch([])).toEqual([])
    expect(inner.embedBatch).not.toHaveBeenCalled()
  })

  it('calls inner.embedBatch once when texts fit in one sub-batch', async () => {
    const inner = makeInner()
    const bp = new BatchingProvider(inner, { maxSubBatchSize: 10 })
    const texts = ['a', 'b', 'c']
    const result = await bp.embedBatch(texts)
    expect(inner.embedBatch).toHaveBeenCalledTimes(1)
    expect(inner.embedBatch).toHaveBeenCalledWith(texts)
    expect(result).toHaveLength(3)
  })

  it('splits large batches into sub-batches of maxSubBatchSize', async () => {
    const inner = makeInner()
    const bp = new BatchingProvider(inner, { maxSubBatchSize: 3 })
    const texts = ['a', 'b', 'c', 'd', 'e', 'f', 'g']  // 7 → sub-batches [3,3,1]
    const result = await bp.embedBatch(texts)
    expect(inner.embedBatch).toHaveBeenCalledTimes(3)
    expect(result).toHaveLength(7)
  })

  it('retries a failing sub-batch before propagating', async () => {
    let calls = 0
    const inner = makeInner({
      embedBatch: vi.fn().mockImplementation((texts: string[]) => {
        calls++
        if (calls < 3) return Promise.reject(new Error('transient'))
        return Promise.resolve(texts.map(() => [0.1, 0.2, 0.3, 0.4]))
      }),
    })
    const bp = new BatchingProvider(inner, { retries: 3, retryDelayMs: 0 })
    const result = await bp.embedBatch(['x', 'y'])
    expect(result).toHaveLength(2)
    expect(calls).toBe(3)  // failed twice, succeeded on 3rd
  })

  it('falls back to per-item embed when all sub-batch retries fail', async () => {
    const inner = makeInner({
      embedBatch: vi.fn().mockRejectedValue(new Error('batch always fails')),
      embed: vi.fn().mockResolvedValue([1, 2, 3, 4]),
    })
    const bp = new BatchingProvider(inner, { retries: 1, retryDelayMs: 0 })
    const result = await bp.embedBatch(['a', 'b'])
    expect(result).toHaveLength(2)
    expect(inner.embed).toHaveBeenCalledTimes(2)
  })

  it('returns zero vectors for items that fail even the per-item fallback', async () => {
    const inner = makeInner({
      embedBatch: vi.fn().mockRejectedValue(new Error('batch fails')),
      embed: vi.fn().mockRejectedValue(new Error('item fails')),
      dimensions: 4,
    })
    const bp = new BatchingProvider(inner, { retries: 0, retryDelayMs: 0 })
    const result = await bp.embedBatch(['a'])
    expect(result).toHaveLength(1)
    expect(result[0]).toHaveLength(4)
    expect(result[0].every((v: number) => v === 0)).toBe(true)
  })

  it('works with a provider that has no embedBatch (falls back to per-item)', async () => {
    const inner: EmbeddingProvider = {
      model: 'no-batch',
      dimensions: 2,
      embed: vi.fn().mockResolvedValue([0.5, 0.5]),
      // embedBatch intentionally omitted
    }
    const bp = new BatchingProvider(inner, { maxSubBatchSize: 5 })
    const result = await bp.embedBatch(['a', 'b', 'c'])
    expect(result).toHaveLength(3)
    expect(inner.embed).toHaveBeenCalledTimes(3)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// OllamaProvider — batch endpoint
// ──────────────────────────────────────────────────────────────────────────────

describe('OllamaProvider.embedBatch (Phase 62)', () => {
  it('uses /api/embed for batch when endpoint is available', async () => {
    const mockFetch = vi.fn()
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ embeddings: [[0.1, 0.2], [0.3, 0.4]] }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const provider = new OllamaProvider({ baseUrl: 'http://localhost:11434', model: 'nomic-embed-text' })
    const result = await provider.embedBatch(['hello', 'world'])

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:11434/api/embed',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(result).toEqual([[0.1, 0.2], [0.3, 0.4]])
  })

  it('falls back to serial /api/embeddings when /api/embed returns 404', async () => {
    const mockFetch = vi.fn()
    // First call hits /api/embed → 404
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })
    // Subsequent calls hit /api/embeddings (one per text)
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ embedding: [0.9, 0.8] }),
    })

    vi.stubGlobal('fetch', mockFetch)
    const provider = new OllamaProvider({ baseUrl: 'http://localhost:11434', model: 'test' })
    const result = await provider.embedBatch(['a', 'b'])

    // Should have called /api/embed once, then /api/embeddings twice
    expect(mockFetch).toHaveBeenCalledTimes(3)
    const urls = mockFetch.mock.calls.map((c: [string]) => c[0])
    expect(urls[0]).toMatch(/\/api\/embed$/)
    expect(urls[1]).toContain('/api/embeddings')
    expect(urls[2]).toContain('/api/embeddings')
    expect(result).toHaveLength(2)
  })

  it('remembers 404 and skips /api/embed on subsequent calls', async () => {
    const mockFetch = vi.fn()
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ embedding: [1, 2] }),
    })

    vi.stubGlobal('fetch', mockFetch)
    const provider = new OllamaProvider({ baseUrl: 'http://localhost:11434', model: 'test' })

    // First call: hits /api/embed (404), then falls back to serial
    await provider.embedBatch(['x'])
    // Second call: should skip /api/embed probe entirely
    await provider.embedBatch(['y'])

    // Total fetch calls: 1 probe + 1 serial (1st batch) + 1 serial (2nd batch) = 3
    expect(mockFetch).toHaveBeenCalledTimes(3)
    const urls = mockFetch.mock.calls.map((c: [string]) => c[0])
    // Only one /api/embed call (the first probe); subsequent calls use /api/embeddings
    const batchEndpointCalls = urls.filter((u: string) => u.endsWith('/api/embed'))
    expect(batchEndpointCalls.length).toBe(1)
  })

  it('throws on non-404 server errors from /api/embed', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    })
    vi.stubGlobal('fetch', mockFetch)

    const provider = new OllamaProvider()
    await expect(provider.embedBatch(['test'])).rejects.toThrow('Ollama batch embed failed (500)')
  })

  it('sets dimensions from batch response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ embeddings: [[1, 2, 3, 4, 5, 6, 7, 8]] }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const provider = new OllamaProvider()
    expect(provider.dimensions).toBe(0)
    await provider.embedBatch(['hello'])
    expect(provider.dimensions).toBe(8)
  })
})
