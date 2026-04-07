import { describe, it, expect } from 'vitest'
import {
  getProfileDefaults,
  resolveEmbedBatchSize,
  AdaptiveBatchController,
  postRunRecommendations,
} from '../src/core/indexing/adaptiveTuning.js'

// Minimal mock provider that supports embedBatch
const providerWithBatch = {
  embed: async () => new Float32Array(4),
  embedBatch: async (texts: string[]) => texts.map(() => new Float32Array(4)),
  dimensions: 4,
  model: 'test-model',
}

// Minimal mock provider without embedBatch
const providerWithoutBatch = {
  embed: async () => new Float32Array(4),
  dimensions: 4,
  model: 'test-model',
}

describe('getProfileDefaults', () => {
  it('returns speed profile', () => {
    const p = getProfileDefaults('speed')
    expect(p.concurrency).toBe(8)
    expect(p.embedBatchSize).toBe(32)
    expect(p.chunker).toBe('file')
  })

  it('returns balanced profile', () => {
    const p = getProfileDefaults('balanced')
    expect(p.concurrency).toBe(4)
    expect(p.embedBatchSize).toBe(16)
    expect(p.chunker).toBe('file')
  })

  it('returns quality profile', () => {
    const p = getProfileDefaults('quality')
    expect(p.concurrency).toBe(2)
    expect(p.embedBatchSize).toBe(4)
    expect(p.chunker).toBe('function')
  })

  it('throws on unknown profile', () => {
    expect(() => getProfileDefaults('turbo')).toThrow(/Unknown --profile/)
  })
})

describe('resolveEmbedBatchSize', () => {
  it('respects explicit user value', () => {
    const size = resolveEmbedBatchSize({ userValue: 8, provider: providerWithBatch })
    expect(size).toBe(8)
  })

  it('auto-detects batch support with default size 16', () => {
    const size = resolveEmbedBatchSize({ userValue: undefined, provider: providerWithBatch })
    expect(size).toBe(16)
  })

  it('uses profileBatchSize when provider supports embedBatch', () => {
    const size = resolveEmbedBatchSize({ userValue: undefined, provider: providerWithBatch, profileBatchSize: 32 })
    expect(size).toBe(32)
  })

  it('falls back to 1 when provider lacks embedBatch', () => {
    const size = resolveEmbedBatchSize({ userValue: undefined, provider: providerWithoutBatch })
    expect(size).toBe(1)
  })
})

describe('AdaptiveBatchController', () => {
  it('starts at the initial batch size', () => {
    const ctrl = new AdaptiveBatchController({ initialBatchSize: 16 })
    expect(ctrl.batchSize).toBe(16)
  })

  it('widens batch after 3 consecutive good windows', () => {
    const ctrl = new AdaptiveBatchController({ initialBatchSize: 16, targetLatencyMs: 50 })
    ctrl.observe({ latencyPerItemMs: 10, hadError: false })
    ctrl.observe({ latencyPerItemMs: 10, hadError: false })
    ctrl.observe({ latencyPerItemMs: 10, hadError: false })
    expect(ctrl.batchSize).toBeGreaterThan(16)
  })

  it('shrinks batch when latency too high', () => {
    const ctrl = new AdaptiveBatchController({ initialBatchSize: 16, targetLatencyMs: 50 })
    ctrl.observe({ latencyPerItemMs: 200, hadError: false })
    expect(ctrl.batchSize).toBeLessThan(16)
  })

  it('halves batch on repeated errors', () => {
    const ctrl = new AdaptiveBatchController({ initialBatchSize: 16 })
    ctrl.observe({ latencyPerItemMs: 10, hadError: true })
    ctrl.observe({ latencyPerItemMs: 10, hadError: true })
    expect(ctrl.batchSize).toBeLessThanOrEqual(8)
  })

  it('respects minimum batch size', () => {
    const ctrl = new AdaptiveBatchController({ initialBatchSize: 2, minBatchSize: 1 })
    // Drive it to minimum
    for (let i = 0; i < 10; i++) ctrl.observe({ latencyPerItemMs: 10, hadError: true })
    expect(ctrl.batchSize).toBeGreaterThanOrEqual(1)
  })

  it('respects maximum batch size', () => {
    const ctrl = new AdaptiveBatchController({ initialBatchSize: 100, maxBatchSize: 128, targetLatencyMs: 50 })
    for (let i = 0; i < 20; i++) ctrl.observe({ latencyPerItemMs: 1, hadError: false })
    expect(ctrl.batchSize).toBeLessThanOrEqual(128)
  })
})

describe('postRunRecommendations', () => {
  it('recommends VSS when over 10K blobs', () => {
    const recs = postRunRecommendations({ indexed: 5000, existingBlobCount: 8000 })
    expect(recs.some((r) => r.includes('build-vss'))).toBe(true)
  })

  it('recommends vacuum when over 50K blobs', () => {
    const recs = postRunRecommendations({ indexed: 10000, existingBlobCount: 45000 })
    expect(recs.some((r) => r.includes('vacuum'))).toBe(true)
  })

  it('recommends backfill-fts when hasFtsGap is true', () => {
    const recs = postRunRecommendations({ indexed: 100, existingBlobCount: 100, hasFtsGap: true })
    expect(recs.some((r) => r.includes('backfill-fts'))).toBe(true)
  })

  it('returns empty array for small indexes', () => {
    const recs = postRunRecommendations({ indexed: 50, existingBlobCount: 100 })
    expect(recs).toHaveLength(0)
  })
})
