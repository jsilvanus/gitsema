import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../src/core/embedding/providerFactory.js', () => ({
  applyModelOverrides: vi.fn(),
  buildProvider: vi.fn().mockReturnValue({ embed: vi.fn(), model: 'm' }),
}))
vi.mock('../src/core/embedding/embedQuery.js', () => ({
  embedQuery: vi.fn().mockResolvedValue([0.1, 0.2]),
}))
vi.mock('../src/core/search/impact.js', () => ({
  computeImpact: vi.fn().mockResolvedValue({ targetPath: 'src/x.ts', results: [] }),
}))
vi.mock('../src/core/search/changePoints.js', () => ({
  computeConceptChangePoints: vi.fn().mockReturnValue({
    type: 'concept-change-points',
    query: 'q',
    k: 5,
    threshold: 0.3,
    range: { since: null, until: null },
    points: [],
  }),
}))
vi.mock('../src/core/search/experts.js', () => ({
  computeExperts: vi.fn().mockReturnValue([]),
}))
vi.mock('../src/core/search/vectorSearch.js', () => ({
  vectorSearch: vi.fn().mockReturnValue([]),
}))

import { workflowCommand } from '../src/cli/commands/workflow.js'

describe('workflowCommand', () => {
  beforeEach(() => { vi.clearAllMocks() })
  afterEach(() => { vi.restoreAllMocks() })

  it('runs pr-review template with --file', async () => {
    await expect(
      workflowCommand('pr-review', [], { file: 'src/index.ts', query: 'auth', top: '1' }),
    ).resolves.not.toThrow()
  })

  it('runs incident template with --query', async () => {
    await expect(
      workflowCommand('incident', [], { query: 'auth token', top: '1' }),
    ).resolves.not.toThrow()
  })

  it('runs release-audit template', async () => {
    await expect(
      workflowCommand('release-audit', [], { top: '1' }),
    ).resolves.not.toThrow()
  })

  it('exits on unknown template', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`)
    }) as never)
    await expect(
      workflowCommand('invalid-template', [], {}),
    ).rejects.toThrow('exit:1')
    exitSpy.mockRestore()
  })

  it('exits when pr-review missing --file', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`)
    }) as never)
    await expect(
      workflowCommand('pr-review', [], {}),
    ).rejects.toThrow('exit:1')
    exitSpy.mockRestore()
  })
})
