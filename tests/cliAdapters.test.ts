/**
 * Unit tests for CLI tool adapters (src/core/narrator/cliAdapters.ts).
 *
 * Pure argv-building / output-parsing tests — no subprocesses spawned.
 */
import { describe, it, expect } from 'vitest'
import { getCliAdapter } from '../src/core/narrator/cliAdapters.js'
import type { CliNarratorParams } from '../src/core/narrator/types.js'

function params(overrides: Partial<CliNarratorParams> = {}): CliNarratorParams {
  return { cliCommand: 'claude', ...overrides }
}

describe('claude adapter', () => {
  const adapter = getCliAdapter('claude')

  it('builds one-shot args with -p and json output', () => {
    const args = adapter.buildOneShotArgs('hello', params())
    expect(args).toEqual(['-p', 'hello', '--output-format', 'json'])
  })

  it('includes cliArgs before the prompt', () => {
    const args = adapter.buildOneShotArgs('hello', params({ cliArgs: ['--model', 'opus'] }))
    expect(args).toEqual(['--model', 'opus', '-p', 'hello', '--output-format', 'json'])
  })

  it('builds guide args with --mcp-config and --allowedTools when useMcp is set', () => {
    const args = adapter.buildGuideArgs('q', params({ useMcp: true }), { mcpConfigPath: '/tmp/mcp.json' })
    expect(args).toContain('--mcp-config')
    expect(args).toContain('/tmp/mcp.json')
    expect(args).toContain('--allowedTools')
    expect(args).toContain('mcp__gitsema__*')
  })

  it('omits --mcp-config when useMcp is not set, even if a path is provided', () => {
    const args = adapter.buildGuideArgs('q', params(), { mcpConfigPath: '/tmp/mcp.json' })
    expect(args).not.toContain('--mcp-config')
  })

  it('adds --resume when resumeSessionId is provided', () => {
    const args = adapter.buildGuideArgs('q', params(), { resumeSessionId: 'session-123' })
    expect(args).toEqual(['-p', 'q', '--output-format', 'json', '--resume', 'session-123'])
  })

  it('parses JSON stdout into prose + session id', () => {
    const stdout = JSON.stringify({ result: 'The answer.', session_id: 'sess-1' })
    expect(adapter.parseOutput(stdout)).toEqual({ prose: 'The answer.', sessionId: 'sess-1' })
  })

  it('falls back to raw text when stdout is not valid JSON', () => {
    expect(adapter.parseOutput('plain text output')).toEqual({ prose: 'plain text output' })
  })
})

describe('codex adapter', () => {
  const adapter = getCliAdapter('codex')

  it('builds one-shot args as "exec <prompt>"', () => {
    expect(adapter.buildOneShotArgs('hello', params({ cliCommand: 'codex' }))).toEqual(['exec', 'hello'])
  })

  it('guide args ignore mcpConfigPath / resumeSessionId (best-effort, no MCP/session support)', () => {
    const p = params({ cliCommand: 'codex', useMcp: true })
    const args = adapter.buildGuideArgs('hello', p, { mcpConfigPath: '/tmp/mcp.json', resumeSessionId: 'sess' })
    expect(args).toEqual(['exec', 'hello'])
  })

  it('parses raw stdout as prose with no session id', () => {
    expect(adapter.parseOutput('  some output\n')).toEqual({ prose: 'some output' })
  })
})

describe('copilot adapter', () => {
  const adapter = getCliAdapter('copilot')

  it('builds one-shot args as "copilot explain <prompt>"', () => {
    expect(adapter.buildOneShotArgs('hello', params({ cliCommand: 'gh' }))).toEqual(['copilot', 'explain', 'hello'])
  })

  it('is also resolved via the "gh" cliCommand', () => {
    expect(getCliAdapter('gh')).toBe(adapter)
  })

  it('guide args are the same as one-shot (no MCP/session support)', () => {
    const p = params({ cliCommand: 'gh', useMcp: true })
    const args = adapter.buildGuideArgs('hello', p, { mcpConfigPath: '/tmp/mcp.json', resumeSessionId: 'sess' })
    expect(args).toEqual(['copilot', 'explain', 'hello'])
  })
})

describe('generic fallback adapter', () => {
  it('is used for unknown cliCommand values', () => {
    const adapter = getCliAdapter('some-custom-tool')
    expect(adapter.buildOneShotArgs('hello', params({ cliCommand: 'some-custom-tool' }))).toEqual(['hello'])
  })

  it('includes cliArgs before the prompt', () => {
    const adapter = getCliAdapter('some-custom-tool')
    const args = adapter.buildOneShotArgs('hello', params({ cliCommand: 'some-custom-tool', cliArgs: ['--flag'] }))
    expect(args).toEqual(['--flag', 'hello'])
  })

  it('guide args equal one-shot args', () => {
    const adapter = getCliAdapter('some-custom-tool')
    const p = params({ cliCommand: 'some-custom-tool' })
    expect(adapter.buildGuideArgs('hello', p, {})).toEqual(adapter.buildOneShotArgs('hello', p))
  })

  it('parses raw stdout as prose', () => {
    const adapter = getCliAdapter('some-custom-tool')
    expect(adapter.parseOutput(' raw output \n')).toEqual({ prose: 'raw output' })
  })
})

describe('getCliAdapter path handling', () => {
  it('resolves adapters from a full path to the executable', () => {
    expect(getCliAdapter('/usr/local/bin/claude')).toBe(getCliAdapter('claude'))
  })
})
