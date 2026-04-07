import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../src/core/search/experts.js', () => ({
  computeExperts: vi.fn().mockReturnValue([
    { authorName: 'Alice', authorEmail: 'alice@example.com', blobCount: 5, clusters: [] },
  ]),
}))

vi.mock('../src/core/search/semanticDiff.js', () => ({
  computeSemanticDiff: vi.fn().mockReturnValue({
    ref1: 'HEAD~1',
    ref2: 'HEAD',
    topic: 'src/foo.ts',
    gained: [],
    lost: [],
    stable: [],
    timestamp1: 0,
    timestamp2: 0,
  }),
}))

vi.mock('../src/core/search/impact.js', () => ({
  computeImpact: vi.fn().mockResolvedValue({ file: 'src/foo.ts', coupled: [{ paths: ['src/bar.ts'], score: 0.9, blobHash: 'abc' }] }),
}))

vi.mock('../src/core/search/changePoints.js', () => ({
  computeConceptChangePoints: vi.fn().mockReturnValue({ type: 'concept-change-points', points: [] }),
}))

vi.mock('../src/core/embedding/providerFactory.js', () => ({
  buildProvider: vi.fn().mockResolvedValue(undefined),
  getTextProvider: vi.fn().mockReturnValue({ embed: vi.fn().mockResolvedValue(new Float32Array(4)) }),
}))

vi.mock('../src/core/embedding/embedQuery.js', () => ({
  embedQuery: vi.fn().mockResolvedValue(new Float32Array(4)),
}))

import { prReportCommand } from '../src/cli/commands/prReport.js'

describe('prReportCommand', () => {
  let output: string[] = []

  beforeEach(() => {
    output = []
    vi.spyOn(console, 'log').mockImplementation((...args) => { output.push(args.join(' ')) })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('outputs human-readable report', async () => {
    await prReportCommand({ ref1: 'HEAD~1', ref2: 'HEAD', file: 'src/foo.ts' })
    const joined = output.join('\n')
    expect(joined).toContain('Semantic PR Report')
    expect(joined).toContain('Suggested reviewers')
    expect(joined).toContain('Alice')
  })

  it('outputs JSON dump to stdout when --dump is boolean', async () => {
    await prReportCommand({ dump: true, file: 'src/foo.ts' })
    const joined = output.join('\n')
    const parsed = JSON.parse(joined)
    expect(parsed).toHaveProperty('generatedAt')
    expect(parsed).toHaveProperty('reviewerSuggestions')
  })
})
