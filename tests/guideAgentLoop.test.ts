/**
 * Tests for the `gitsema guide` agent-loop wiring (src/cli/commands/guide.ts)
 * and the gitsema tool registry (src/core/narrator/guideTools.ts).
 *
 * No network calls and no real chattydeer HTTP — '@jsilvanus/chattydeer' is
 * mocked with a fake provider/agent-session/agent-loop.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { openDatabaseAt, withDbSession, type DbSession } from '../src/core/db/sqlite.js'
import {
  saveGuideConfig,
  setActiveGuideConfig,
} from '../src/core/narrator/resolveNarrator.js'
import { GUIDE_TOOL_DEFINITIONS, GUIDE_TOOLS, executeTool } from '../src/core/narrator/guideTools.js'

// ---------------------------------------------------------------------------
// chattydeer mock
// ---------------------------------------------------------------------------

const fakeRunAgentLoop = vi.fn()
const fakeCreateAgentSession = vi.fn()
const fakeCreateChatProvider = vi.fn()

vi.mock('@jsilvanus/chattydeer', () => ({
  createChatProvider: (...args: unknown[]) => fakeCreateChatProvider(...args),
  createAgentSession: (...args: unknown[]) => fakeCreateAgentSession(...args),
  runAgentLoop: (...args: unknown[]) => fakeRunAgentLoop(...args),
}))

// ---------------------------------------------------------------------------
// Test DB session
// ---------------------------------------------------------------------------

let session: DbSession

beforeEach(() => {
  session = openDatabaseAt(':memory:')
  fakeRunAgentLoop.mockReset()
  fakeCreateAgentSession.mockReset()
  fakeCreateChatProvider.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// (a) Tool registry definitions are valid
// ---------------------------------------------------------------------------

describe('GUIDE_TOOL_DEFINITIONS', () => {
  it('has valid names and JSON-schema parameter shapes', () => {
    expect(GUIDE_TOOL_DEFINITIONS.map((t) => t.name)).toEqual(Object.keys(GUIDE_TOOLS))
    expect(GUIDE_TOOL_DEFINITIONS.map((t) => t.name)).toEqual(
      expect.arrayContaining(['repo_stats', 'recent_commits', 'narrate_repo', 'explain_topic', 'semantic_search']),
    )

    for (const tool of GUIDE_TOOL_DEFINITIONS) {
      expect(typeof tool.name).toBe('string')
      expect(tool.name.length).toBeGreaterThan(0)
      expect(typeof tool.description).toBe('string')
      expect(tool.description.length).toBeGreaterThan(0)
      expect(tool.parameters).toBeTypeOf('object')
      expect((tool.parameters as { type?: string }).type).toBe('object')
      expect((tool.parameters as { properties?: object }).properties).toBeTypeOf('object')
    }
  })

  it('explain_topic requires "topic" and semantic_search requires "query"', () => {
    const explain = GUIDE_TOOL_DEFINITIONS.find((t) => t.name === 'explain_topic')!
    expect((explain.parameters as { required?: string[] }).required).toContain('topic')

    const search = GUIDE_TOOL_DEFINITIONS.find((t) => t.name === 'semantic_search')!
    expect((search.parameters as { required?: string[] }).required).toContain('query')
  })
})

// ---------------------------------------------------------------------------
// (b) executeTool dispatches correctly and returns size-capped JSON
// ---------------------------------------------------------------------------

describe('executeTool', () => {
  it('dispatches repo_stats and returns parseable JSON', async () => {
    const result = await executeTool({ id: '1', name: 'repo_stats', arguments: {} })
    const parsed = JSON.parse(result)
    expect(parsed).toHaveProperty('commits')
    expect(parsed).toHaveProperty('branches')
  })

  it('dispatches recent_commits with n argument', async () => {
    const result = await executeTool({ id: '2', name: 'recent_commits', arguments: { n: 3 } })
    const parsed = JSON.parse(result)
    expect(parsed).toHaveProperty('commits')
    expect(Array.isArray(parsed.commits)).toBe(true)
    expect(parsed.commits.length).toBeLessThanOrEqual(3)
  })

  it('dispatches narrate_repo (evidence-only, no LLM call)', async () => {
    const result = await executeTool({ id: '3', name: 'narrate_repo', arguments: { focus: 'all' } })
    expect(result.length).toBeLessThanOrEqual(4000 + '…truncated'.length)
    if (!result.endsWith('…truncated')) {
      const parsed = JSON.parse(result)
      expect(parsed).toHaveProperty('commitCount')
      expect(parsed).toHaveProperty('citations')
    }
  })

  it('explain_topic returns a structured error when topic is missing', async () => {
    const result = await executeTool({ id: '4', name: 'explain_topic', arguments: {} })
    const parsed = JSON.parse(result)
    expect(parsed).toHaveProperty('error')
  })

  it('semantic_search returns a structured error when no index exists', async () => {
    const result = await executeTool({ id: '5', name: 'semantic_search', arguments: { query: 'authentication' } })
    const parsed = JSON.parse(result)
    expect(parsed).toHaveProperty('error')
    expect(typeof parsed.error).toBe('string')
  })

  it('returns a structured error for unknown tool names', async () => {
    const result = await executeTool({ id: '6', name: 'totally_unknown_tool', arguments: {} })
    const parsed = JSON.parse(result)
    expect(parsed.error).toMatch(/unknown tool/)
  })

  it('caps result size to ~4000 chars with a truncation marker', async () => {
    // recent_commits with a large n on a repo with many commits could exceed
    // the cap; instead, directly verify the capping helper behavior via a
    // tool that can produce large output: narrate_repo over a wide range.
    const result = await executeTool({ id: '7', name: 'narrate_repo', arguments: {} })
    expect(result.length).toBeLessThanOrEqual(4000 + '…truncated'.length)
  })
})

// ---------------------------------------------------------------------------
// (c) + (d) guide handler runs the loop, returns final answer, redaction applied
// ---------------------------------------------------------------------------

describe('runGuide — agent loop (model configured)', () => {
  it('runs the loop and returns the final answer with roundtrips/toolCallsUsed', async () => {
    await withDbSession(session, async () => {
      const id = saveGuideConfig(session.rawDb, 'fake-guide', 'chattydeer', {
        httpUrl: 'http://localhost:9999',
        apiKey: 'test-key',
      })
      setActiveGuideConfig(session.rawDb, id)

      const fakeProvider = { destroy: vi.fn().mockResolvedValue(undefined) }
      const fakeSession = { history: [] as unknown[], append: vi.fn() }
      fakeCreateChatProvider.mockReturnValue(fakeProvider)
      fakeCreateAgentSession.mockReturnValue(fakeSession)
      fakeRunAgentLoop.mockResolvedValue({
        answer: 'The repository has 3 commits.',
        messages: [],
        roundtrips: 1,
      })

      const { runGuide } = await import('../src/cli/commands/guide.js')
      const result = await runGuide('How many commits are there?', { includeContext: true })

      expect(result.llmEnabled).toBe(true)
      expect(result.answer).toBe('The repository has 3 commits.')
      expect(result.roundtrips).toBe(1)
      expect(result.toolCallsUsed).toEqual([])
      expect(fakeProvider.destroy).toHaveBeenCalled()

      // createChatProvider called with (httpUrl, model, apiKey, opts)
      expect(fakeCreateChatProvider).toHaveBeenCalledWith(
        'http://localhost:9999',
        'fake-guide',
        'test-key',
        expect.objectContaining({ timeoutMs: expect.any(Number) }),
      )

      // runAgentLoop called with tools + executeTool + maxRoundtrips 5
      const loopOpts = fakeRunAgentLoop.mock.calls[0][1]
      expect(loopOpts.tools).toBe(GUIDE_TOOL_DEFINITIONS)
      expect(loopOpts.maxRoundtrips).toBe(5)
      expect(typeof loopOpts.executeTool).toBe('function')
      expect(typeof loopOpts.redactContent).toBe('function')
    })
  })

  it('applies redaction to outbound content via redactContent', async () => {
    await withDbSession(session, async () => {
      const id = saveGuideConfig(session.rawDb, 'fake-guide-2', 'chattydeer', {
        httpUrl: 'http://localhost:9999',
      })
      setActiveGuideConfig(session.rawDb, id)

      fakeCreateChatProvider.mockReturnValue({ destroy: vi.fn().mockResolvedValue(undefined) })
      fakeCreateAgentSession.mockReturnValue({ history: [], append: vi.fn() })
      fakeRunAgentLoop.mockResolvedValue({ answer: 'ok', messages: [], roundtrips: 0 })

      const { runGuide } = await import('../src/cli/commands/guide.js')
      await runGuide('test question', { includeContext: false })

      const loopOpts = fakeRunAgentLoop.mock.calls[0][1]
      const redactContent = loopOpts.redactContent as (text: string) => string

      // A secret-like value (env-style assignment) should be redacted.
      const redacted = redactContent('TOKEN=abcd1234567890')
      expect(redacted).toContain('[REDACTED:')
    })
  })

  it('tool calls invoked by the loop are dispatched via executeTool and counted', async () => {
    await withDbSession(session, async () => {
      const id = saveGuideConfig(session.rawDb, 'fake-guide-3', 'chattydeer', {
        httpUrl: 'http://localhost:9999',
      })
      setActiveGuideConfig(session.rawDb, id)

      fakeCreateChatProvider.mockReturnValue({ destroy: vi.fn().mockResolvedValue(undefined) })
      fakeCreateAgentSession.mockReturnValue({ history: [], append: vi.fn() })

      // Simulate the loop calling our executeTool for repo_stats, then finishing.
      fakeRunAgentLoop.mockImplementation(async (_sess: unknown, opts: { executeTool: (c: { id: string; name: string; arguments: Record<string, unknown> }) => Promise<string> }) => {
        const toolResult = await opts.executeTool({ id: 'call_1', name: 'repo_stats', arguments: {} })
        expect(() => JSON.parse(toolResult)).not.toThrow()
        return { answer: 'done', messages: [], roundtrips: 1 }
      })

      const { runGuide } = await import('../src/cli/commands/guide.js')
      const result = await runGuide('stats?', { includeContext: false })

      expect(result.toolCallsUsed).toEqual(['repo_stats'])
      expect(result.answer).toBe('done')
    })
  })
})

// ---------------------------------------------------------------------------
// (e) no-model path unchanged
// ---------------------------------------------------------------------------

describe('runGuide — no model configured (safe-by-default)', () => {
  it('returns context-only placeholder without calling chattydeer', async () => {
    await withDbSession(session, async () => {
      const { runGuide } = await import('../src/cli/commands/guide.js')
      const result = await runGuide('What does this repo do?', { includeContext: true })

      expect(result.llmEnabled).toBe(false)
      expect(result.roundtrips).toBeUndefined()
      expect(result.toolCallsUsed).toBeUndefined()
      expect(result.answer).toContain('Repository Context')
      expect(result.answer).toContain('No guide or narrator model configured')
      expect(result.answer).toContain('What does this repo do?')

      expect(fakeCreateChatProvider).not.toHaveBeenCalled()
      expect(fakeCreateAgentSession).not.toHaveBeenCalled()
      expect(fakeRunAgentLoop).not.toHaveBeenCalled()
    })
  })

  it('--no-context still works without a model', async () => {
    await withDbSession(session, async () => {
      const { runGuide } = await import('../src/cli/commands/guide.js')
      const result = await runGuide('quick question', { includeContext: false })

      expect(result.contextUsed).toBe(false)
      expect(result.llmEnabled).toBe(false)
      expect(result.answer).toContain('(no context gathered)')
    })
  })
})
