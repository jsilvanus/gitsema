/**
 * Tests for CliNarratorProvider (src/core/narrator/cliProvider.ts).
 *
 * `node:child_process` is mocked — no real subprocesses are spawned.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const fakeExecFile = vi.fn()

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => fakeExecFile(...args),
}))

beforeEach(() => {
  fakeExecFile.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CliNarratorProvider — disabled (safe-by-default)', () => {
  it('returns a disabled placeholder without spawning a subprocess', async () => {
    const { createDisabledCliProvider } = await import('../src/core/narrator/cliProvider.js')
    const provider = createDisabledCliProvider('narrator')

    const res = await provider.narrate({ systemPrompt: 'sys', userPrompt: 'user' })

    expect(res.llmEnabled).toBe(false)
    expect(res.prose).toContain('narrator disabled')
    expect(fakeExecFile).not.toHaveBeenCalled()
  })
})

describe('CliNarratorProvider — enabled', () => {
  it('spawns the configured CLI tool and returns parsed prose', async () => {
    fakeExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, JSON.stringify({ result: 'Generated narrative.', session_id: 'sess-1' }), '')
    })

    const { createCliProvider } = await import('../src/core/narrator/cliProvider.js')
    const provider = createCliProvider('my-claude', { cliCommand: 'claude' })

    const res = await provider.narrate({ systemPrompt: 'You are a narrator.', userPrompt: 'Summarize this.' })

    expect(res.llmEnabled).toBe(true)
    expect(res.prose).toBe('Generated narrative.')
    expect(res.tokensUsed).toBe(0)

    expect(fakeExecFile).toHaveBeenCalledTimes(1)
    const [command, args] = fakeExecFile.mock.calls[0]
    expect(command).toBe('claude')
    expect(args).toEqual(['-p', expect.stringContaining('Summarize this.'), '--output-format', 'json'])
    // System prompt is combined into the single prompt argument.
    expect(args[1]).toContain('You are a narrator.')
  })

  it('redacts secrets from the prompt before spawning', async () => {
    fakeExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, JSON.stringify({ result: 'ok' }), '')
    })

    const { createCliProvider } = await import('../src/core/narrator/cliProvider.js')
    const provider = createCliProvider('my-claude', { cliCommand: 'claude' })

    const res = await provider.narrate({
      systemPrompt: 'sys',
      userPrompt: 'here is a token: ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    })

    expect(res.redactedFields).toContain('github-pat')
    const [, args] = fakeExecFile.mock.calls[0]
    expect(args[1]).not.toContain('ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    expect(args[1]).toContain('[REDACTED:github-pat]')
  })

  it('returns a graceful error response when the subprocess fails', async () => {
    fakeExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(new Error('spawn ENOENT'), '', 'command not found')
    })

    const { createCliProvider } = await import('../src/core/narrator/cliProvider.js')
    const provider = createCliProvider('missing-tool', { cliCommand: 'does-not-exist' })

    const res = await provider.narrate({ systemPrompt: 'sys', userPrompt: 'user' })

    expect(res.llmEnabled).toBe(true)
    expect(res.prose).toContain('narrator error')
  })

  it('uses the generic adapter for an unrecognized cliCommand', async () => {
    fakeExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, 'plain output', '')
    })

    const { createCliProvider } = await import('../src/core/narrator/cliProvider.js')
    const provider = createCliProvider('my-tool', { cliCommand: 'my-custom-ai' })

    const res = await provider.narrate({ systemPrompt: '', userPrompt: 'question' })

    expect(res.prose).toBe('plain output')
    const [command, args] = fakeExecFile.mock.calls[0]
    expect(command).toBe('my-custom-ai')
    expect(args).toEqual(['question'])
  })
})
