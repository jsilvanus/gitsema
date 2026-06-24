/**
 * Tests for `gitsema admin models` (src/cli/commands/admin.ts) and its
 * enforcement inside `gitsema models activate` (Phase 129 /
 * locked-model-set-plan.md §5 Phase 2).
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

describe('models activate — server-wide allow-list enforcement', () => {
  it('blocks activation of a narrator config disabled by server policy', async () => {
    mockDb()
    const { modelsKindAddCommand, modelsKindActivateCommand } = await import('../src/cli/commands/models.js')
    const { denyServer } = await import('../src/core/admin/modelPolicy.js')

    await modelsKindAddCommand('blocked-narrator', 'narrator', { httpUrl: 'http://localhost:9' })
    denyServer(rawDb, 'narrator', 'blocked-narrator', ['blocked-narrator'])

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    await expect(modelsKindActivateCommand('blocked-narrator', 'narrator')).rejects.toThrow('process.exit called')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('allows activation once the config is added back to the server allow-list', async () => {
    mockDb()
    const { modelsKindAddCommand, modelsKindActivateCommand } = await import('../src/cli/commands/models.js')
    const { denyServer, allowServer } = await import('../src/core/admin/modelPolicy.js')
    const { getActiveGuideConfigId, getGuideConfigByName } = await import('../src/core/narrator/resolveNarrator.js')

    await modelsKindAddCommand('reallowed-guide', 'guide', { httpUrl: 'http://localhost:9' })
    denyServer(rawDb, 'guide', 'reallowed-guide', ['reallowed-guide'])
    allowServer(rawDb, 'guide', 'reallowed-guide')

    await modelsKindActivateCommand('reallowed-guide', 'guide')
    const config = getGuideConfigByName(rawDb, 'reallowed-guide')
    expect(getActiveGuideConfigId(rawDb)).toBe(config!.id)
  })

  it('activation succeeds with no explicit policy (default-allow-all, Phase 128 behavior unchanged)', async () => {
    mockDb()
    const { modelsKindAddCommand, modelsKindActivateCommand } = await import('../src/cli/commands/models.js')
    const { getActiveNarratorConfigId, getNarratorConfigByName } = await import('../src/core/narrator/resolveNarrator.js')

    await modelsKindAddCommand('unrestricted-narrator', 'narrator', { httpUrl: 'http://localhost:9' })
    await modelsKindActivateCommand('unrestricted-narrator', 'narrator')

    const config = getNarratorConfigByName(rawDb, 'unrestricted-narrator')
    expect(getActiveNarratorConfigId(rawDb)).toBe(config!.id)
  })
})

describe('admin models allow/deny/reset', () => {
  it('rejects allow for an identifier that is not a defined narrator/guide config', async () => {
    mockDb()
    const { adminCommand } = await import('../src/cli/commands/admin.js')
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    const cmd = adminCommand()
    await expect(
      cmd.parseAsync(['models', 'allow', 'nonexistent', '--kind', 'narrator'], { from: 'user' }),
    ).rejects.toThrow('process.exit called')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('rejects org narrowing widening past the server-wide set', async () => {
    mockDb()
    vi.doMock('../src/core/embedding/profiles.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/core/embedding/profiles.js')>()
      return { ...actual, loadEmbeddingProfileConfigs: () => [{ name: 'a' }, { name: 'b' }] }
    })
    const { createOrg } = await import('../src/core/auth/orgs.js')
    const org = createOrg(rawDb, 'acme', 'team')

    const { denyServer } = await import('../src/core/admin/modelPolicy.js')
    denyServer(rawDb, 'embedding', 'b', ['a', 'b'])

    const { adminCommand } = await import('../src/cli/commands/admin.js')
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    const cmd = adminCommand()
    await expect(
      cmd.parseAsync(['models', 'allow', 'b', '--kind', 'embedding', '--org', org.name], { from: 'user' }),
    ).rejects.toThrow('process.exit called')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('allow/deny/reset round-trip via the CLI action handlers', async () => {
    mockDb()
    vi.doMock('../src/core/embedding/profiles.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/core/embedding/profiles.js')>()
      return { ...actual, loadEmbeddingProfileConfigs: () => [{ name: 'a' }, { name: 'b' }] }
    })
    const { adminCommand, getServerPolicy } = await import('../src/cli/commands/admin.js')

    let cmd = adminCommand()
    await cmd.parseAsync(['models', 'deny', 'b', '--kind', 'embedding'], { from: 'user' })
    expect(getServerPolicy(rawDb, 'embedding')).toEqual({ active: true, names: ['a'] })

    cmd = adminCommand()
    await cmd.parseAsync(['models', 'reset', '--kind', 'embedding'], { from: 'user' })
    expect(getServerPolicy(rawDb, 'embedding')).toEqual({ active: false, names: [] })
  })
})
