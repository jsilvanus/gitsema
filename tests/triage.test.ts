import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../src/core/embedding/providerFactory.js', () => ({
  applyModelOverrides: vi.fn(),
  buildProvider: vi.fn().mockReturnValue({ model: 'm' }),
}))
vi.mock('../src/core/embedding/embedQuery.js', () => ({ embedQuery: vi.fn().mockResolvedValue([0.1, 0.2]) }))
vi.mock('../src/core/search/vectorSearch.js', () => ({ vectorSearch: vi.fn().mockReturnValue([{ blobHash: 'b1', paths: ['p1'], score: 0.9 }]) }))
vi.mock('../src/core/search/changePoints.js', () => ({ computeConceptChangePoints: vi.fn().mockReturnValue([{ distance: 0.2 }]) }))
vi.mock('../src/core/search/semanticBisect.js', () => ({ computeSemanticBisect: vi.fn().mockReturnValue({ culprit: 'abc' }) }))
vi.mock('../src/core/search/evolution.js', () => ({ computeFileEvolution: vi.fn().mockReturnValue([{ path: 'p1' }]) }))
vi.mock('../src/core/search/experts.js', () => ({ computeExperts: vi.fn().mockReturnValue([{ authorName: 'A', authorEmail: 'a', blobCount: 1, clusters: [] }]) }))

import { triageCommand } from '../src/cli/commands/triage.js'
import { embedQuery } from '../src/core/embedding/embedQuery.js'
import { vectorSearch } from '../src/core/search/vectorSearch.js'

describe('triageCommand', () => {
  beforeEach(() => { vi.restoreAllMocks() })
  it('runs sections and dumps JSON to stdout when --dump true', async () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true as any)
    await triageCommand('test', { top: '1', dump: true })
    expect(vi.mocked(embedQuery).mock.calls.length).toBeGreaterThan(0)
    expect(vi.mocked(vectorSearch).mock.calls.length).toBeGreaterThan(0)
    spy.mockRestore()
  })
})
