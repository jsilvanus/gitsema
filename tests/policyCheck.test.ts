import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../src/core/search/debtScoring.js', () => ({
  scoreDebt: vi.fn().mockResolvedValue([
    { blobHash: 'abc', paths: ['src/a.ts'], debtScore: 5, isolationScore: 0.5, ageScore: 0.3, changeFrequency: 2 },
  ]),
}))
vi.mock('../src/core/search/securityScan.js', () => ({
  scanForVulnerabilities: vi.fn().mockResolvedValue([]),
}))
vi.mock('../src/core/embedding/providerFactory.js', () => ({
  applyModelOverrides: vi.fn(),
  buildProvider: vi.fn().mockReturnValue({ embed: vi.fn(), model: 'm' }),
}))
vi.mock('../src/core/embedding/embedQuery.js', () => ({
  embedQuery: vi.fn().mockResolvedValue([0.1, 0.2]),
}))
vi.mock('../src/core/search/changePoints.js', () => ({
  computeConceptChangePoints: vi.fn().mockReturnValue({
    type: 'concept-change-points',
    query: 'x',
    k: 50,
    threshold: 0.3,
    range: { since: null, until: null },
    points: [{ before: { date: '2024-01', commit: 'abc' }, after: { date: '2024-02', commit: 'def' }, distance: 0.1 }],
  }),
}))
vi.mock('../src/core/db/sqlite.js', () => ({
  getActiveSession: vi.fn().mockReturnValue({ rawDb: {} }),
}))

import { policyCheckCommand } from '../src/cli/commands/policyCheck.js'
import { scoreDebt } from '../src/core/search/debtScoring.js'

describe('policyCheckCommand', () => {
  beforeEach(() => { vi.clearAllMocks() })
  afterEach(() => { vi.restoreAllMocks() })

  it('passes when debt threshold not exceeded', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await policyCheckCommand({ maxDebtScore: '10' })
    expect(vi.mocked(scoreDebt).mock.calls.length).toBeGreaterThan(0)
    logSpy.mockRestore()
  })

  it('exits with code 1 when drift exceeds threshold (distance 0.1 > 0)', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`)
    }) as never)
    await expect(
      policyCheckCommand({ maxDrift: '0', query: 'x' }),
    ).rejects.toThrow('exit:1')
    exitSpy.mockRestore()
  })
})
