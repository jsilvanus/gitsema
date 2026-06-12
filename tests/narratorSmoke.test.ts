/**
 * Smoke tests for gitsema narrate / gitsema explain CLI handlers.
 *
 * Uses a mock NarratorProvider to avoid LLM calls.
 * Verifies output shape and safe-by-default behavior.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runNarrate, runExplain } from '../src/core/narrator/narrator.js'
import type { NarratorProvider, NarrateRequest, NarrateResponse } from '../src/core/narrator/types.js'

// ---------------------------------------------------------------------------
// Mock NarratorProvider
// ---------------------------------------------------------------------------

function makeMockProvider(enabled: boolean): NarratorProvider {
  return {
    modelName: 'mock-narrator',
    async narrate(req: NarrateRequest): Promise<NarrateResponse> {
      if (!enabled) {
        return {
          prose: '[LLM narrator disabled]',
          tokensUsed: 0,
          redactedFields: [],
          llmEnabled: false,
        }
      }
      return {
        prose: `Mock narrative for: ${req.userPrompt.slice(0, 50)}`,
        tokensUsed: 42,
        redactedFields: [],
        llmEnabled: true,
      }
    },
    async destroy(): Promise<void> {},
  }
}

// ---------------------------------------------------------------------------
// runNarrate()
// ---------------------------------------------------------------------------

describe('runNarrate()', () => {
  it('returns safe placeholder when provider is disabled (no commits in range)', async () => {
    const provider = makeMockProvider(false)
    // No commits in the future — ensures empty result
    const result = await runNarrate(provider, {
      since: '2099-01-01',
      until: '2099-01-02',
      focus: 'all',
      format: 'md',
    })
    // With no commits, should return early without calling the provider
    expect(result.commitCount).toBe(0)
    expect(result.prose).toContain('No commits matched')
    expect(result.llmEnabled).toBe(false)
  })

  it('returns a NarrationResult with required fields', async () => {
    const provider = makeMockProvider(false)
    const result = await runNarrate(provider, { focus: 'all', format: 'md', maxCommits: 0 })
    expect(result).toHaveProperty('prose')
    expect(result).toHaveProperty('commitCount')
    expect(result).toHaveProperty('citations')
    expect(result).toHaveProperty('redactedFields')
    expect(result).toHaveProperty('llmEnabled')
    expect(result).toHaveProperty('format')
    expect(Array.isArray(result.citations)).toBe(true)
    expect(Array.isArray(result.redactedFields)).toBe(true)
  })

  it('uses the format option', async () => {
    const provider = makeMockProvider(false)
    const mdResult = await runNarrate(provider, { format: 'md', since: '2099-01-01' })
    expect(mdResult.format).toBe('md')

    const jsonResult = await runNarrate(provider, { format: 'json', since: '2099-01-01' })
    expect(jsonResult.format).toBe('json')
  })
})

// ---------------------------------------------------------------------------
// runExplain()
// ---------------------------------------------------------------------------

describe('runExplain()', () => {
  it('returns a NarrationResult for a topic with no matching commits', async () => {
    const provider = makeMockProvider(true)
    // Use a very unlikely error string to get zero matches
    const result = await runExplain(provider, 'xyzzythiscannotexist_98765', {
      format: 'md',
      since: '2099-01-01',
    })
    expect(result).toHaveProperty('prose')
    expect(result).toHaveProperty('commitCount')
    expect(result.format).toBe('md')
  })

  it('returns format=json when requested', async () => {
    const provider = makeMockProvider(false)
    const result = await runExplain(provider, 'some error', { format: 'json', since: '2099-01-01' })
    expect(result.format).toBe('json')
  })

  it('includes citations array in result', async () => {
    const provider = makeMockProvider(true)
    const result = await runExplain(provider, 'test', { format: 'md', since: '2099-01-01' })
    expect(Array.isArray(result.citations)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// NarrationResult shape invariants
// ---------------------------------------------------------------------------

describe('NarrationResult shape', () => {
  it('citations is always an array', async () => {
    const provider = makeMockProvider(false)
    const res = await runNarrate(provider, { since: '2099-01-01', format: 'text' })
    expect(Array.isArray(res.citations)).toBe(true)
  })

  it('redactedFields is always an array', async () => {
    const provider = makeMockProvider(false)
    const res = await runNarrate(provider, { since: '2099-01-01', format: 'text' })
    expect(Array.isArray(res.redactedFields)).toBe(true)
  })

  it('llmEnabled is always a boolean', async () => {
    const provider = makeMockProvider(false)
    const res = await runNarrate(provider, { since: '2099-01-01', format: 'text' })
    expect(typeof res.llmEnabled).toBe('boolean')
  })
})
