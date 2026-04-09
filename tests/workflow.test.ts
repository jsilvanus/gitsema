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
vi.mock('../src/core/search/authorSearch.js', () => ({
  computeAuthorContributions: vi.fn().mockResolvedValue([
    { authorName: 'Alice', authorEmail: 'alice@test.com', totalScore: 0.9, blobCount: 3, blobs: [] },
  ]),
}))
vi.mock('../src/core/search/debtScoring.js', () => ({
  scoreDebt: vi.fn().mockResolvedValue([]),
}))
vi.mock('../src/core/search/healthTimeline.js', () => ({
  computeHealthTimeline: vi.fn().mockReturnValue([]),
}))
vi.mock('../src/core/db/sqlite.js', () => ({
  getActiveSession: vi.fn().mockReturnValue({}),
}))

import { workflowCommand, workflowListCommand, TEMPLATE_DESCRIPTIONS } from '../src/cli/commands/workflow.js'

describe('workflowCommand', () => {
  beforeEach(() => { vi.clearAllMocks() })
  afterEach(() => { vi.restoreAllMocks() })

  // ── Original 3 patterns ────────────────────────────────────────────────

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

  // ── 5 new patterns (review7 §5) ────────────────────────────────────────

  it('runs onboarding template with --role', async () => {
    await expect(
      workflowCommand('onboarding', [], { role: 'auth', top: '1' }),
    ).resolves.not.toThrow()
  })

  it('runs onboarding template with --query fallback', async () => {
    await expect(
      workflowCommand('onboarding', [], { query: 'billing logic', top: '1' }),
    ).resolves.not.toThrow()
  })

  it('runs ownership-intel template with --query', async () => {
    await expect(
      workflowCommand('ownership-intel', [], { query: 'authentication middleware', top: '1' }),
    ).resolves.not.toThrow()
  })

  it('runs arch-drift template', async () => {
    await expect(
      workflowCommand('arch-drift', [], { top: '3' }),
    ).resolves.not.toThrow()
  })

  it('runs knowledge-portal template with --query', async () => {
    await expect(
      workflowCommand('knowledge-portal', [], { query: 'payment processing', top: '1' }),
    ).resolves.not.toThrow()
  })

  it('runs regression-forecast template with --query', async () => {
    await expect(
      workflowCommand('regression-forecast', [], { query: 'auth token validation', top: '1' }),
    ).resolves.not.toThrow()
  })

  it('runs regression-forecast template with --query and --ref', async () => {
    await expect(
      workflowCommand('regression-forecast', [], { query: 'auth', ref: 'main~10', top: '1' }),
    ).resolves.not.toThrow()
  })

  // ── Error paths ───────────────────────────────────────────────────────

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

  it('exits when ownership-intel missing --query', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`)
    }) as never)
    await expect(
      workflowCommand('ownership-intel', [], {}),
    ).rejects.toThrow('exit:1')
    exitSpy.mockRestore()
  })

  it('exits when knowledge-portal missing --query', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`)
    }) as never)
    await expect(
      workflowCommand('knowledge-portal', [], {}),
    ).rejects.toThrow('exit:1')
    exitSpy.mockRestore()
  })

  it('exits when regression-forecast missing --query', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`)
    }) as never)
    await expect(
      workflowCommand('regression-forecast', [], {}),
    ).rejects.toThrow('exit:1')
    exitSpy.mockRestore()
  })
})

describe('workflowListCommand', () => {
  it('prints all 8 pattern names to stdout', () => {
    const logged: string[] = []
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      logged.push(args.join(' '))
    })
    workflowListCommand()
    consoleSpy.mockRestore()
    const output = logged.join('\n')
    expect(output).toContain('pr-review')
    expect(output).toContain('release-audit')
    expect(output).toContain('onboarding')
    expect(output).toContain('incident')
    expect(output).toContain('ownership-intel')
    expect(output).toContain('arch-drift')
    expect(output).toContain('knowledge-portal')
    expect(output).toContain('regression-forecast')
  })

  it('TEMPLATE_DESCRIPTIONS covers all 8 patterns', () => {
    const keys = Object.keys(TEMPLATE_DESCRIPTIONS)
    expect(keys).toHaveLength(8)
    expect(keys).toContain('pr-review')
    expect(keys).toContain('release-audit')
    expect(keys).toContain('onboarding')
    expect(keys).toContain('incident')
    expect(keys).toContain('ownership-intel')
    expect(keys).toContain('arch-drift')
    expect(keys).toContain('knowledge-portal')
    expect(keys).toContain('regression-forecast')
  })
})
