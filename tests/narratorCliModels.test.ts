/**
 * Tests for `gitsema models add --provider cli ...` (src/cli/commands/models.ts).
 *
 * Verifies that CLI-provider narrator/guide configs round-trip through
 * embed_config/params_json and that `models list` displays them correctly.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { openDatabaseAt } from '../src/core/db/sqlite.js'

const testSession = openDatabaseAt(':memory:')
const rawDb = testSession.rawDb

afterEach(() => {
  rawDb.exec(`DELETE FROM embed_config WHERE kind IN ('narrator', 'guide')`)
  rawDb.exec(`DELETE FROM settings`)
  vi.restoreAllMocks()
  vi.resetModules()
})

function mockDb(): void {
  vi.doMock('../src/core/db/sqlite.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/core/db/sqlite.js')>()
    return { ...actual, getRawDb: () => rawDb }
  })
}

describe('models add --provider cli', () => {
  it('saves a CLI narrator config with cliCommand and cliArgs', async () => {
    mockDb()
    const { modelsKindAddCommand } = await import('../src/cli/commands/models.js')
    const { getNarratorConfigByName } = await import('../src/core/narrator/resolveNarrator.js')

    await modelsKindAddCommand('claude-cli', 'narrator', {
      provider: 'cli',
      cliCommand: 'claude',
      cliArgs: '--model opus',
    })

    const config = getNarratorConfigByName(rawDb, 'claude-cli')
    expect(config).not.toBeNull()
    expect(config!.provider).toBe('cli')
    expect(config!.params).toEqual({ cliCommand: 'claude', cliArgs: ['--model', 'opus'] })
  })

  it('saves a CLI guide config with useMcp and activates it', async () => {
    mockDb()
    const { modelsKindAddCommand } = await import('../src/cli/commands/models.js')
    const { getGuideConfigByName, getActiveGuideConfigId } = await import('../src/core/narrator/resolveNarrator.js')

    await modelsKindAddCommand('claude-guide-cli', 'guide', {
      provider: 'cli',
      cliCommand: 'claude',
      useMcp: true,
      activate: true,
    })

    const config = getGuideConfigByName(rawDb, 'claude-guide-cli')
    expect(config).not.toBeNull()
    expect(config!.provider).toBe('cli')
    expect(config!.params).toEqual({ cliCommand: 'claude', useMcp: true })
    expect(getActiveGuideConfigId(rawDb)).toBe(config!.id)
  })

  it('errors when --provider cli is given without --cli-command', async () => {
    mockDb()
    const { modelsKindAddCommand } = await import('../src/cli/commands/models.js')

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    }) as unknown as (code?: number) => never
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(modelsKindAddCommand('bad-cli', 'narrator', { provider: 'cli' })).rejects.toThrow('process.exit called')

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--cli-command is required'))
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})

describe('models list — CLI provider display', () => {
  it('shows cliCommand and --use-mcp in the listing instead of an HTTP URL', async () => {
    mockDb()
    const { modelsKindAddCommand, modelsKindListCommand } = await import('../src/cli/commands/models.js')

    await modelsKindAddCommand('list-cli', 'narrator', {
      provider: 'cli',
      cliCommand: 'codex',
      useMcp: true,
    })

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await modelsKindListCommand('narrator', {})
    const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n')

    expect(output).toContain('cli: codex (--use-mcp)')
  })
})
