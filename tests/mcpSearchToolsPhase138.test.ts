/**
 * MCP `semantic_search` / `first_seen` tool tests for Phase 138 flag parity.
 *
 * Registers the real tool handlers (via `registerSearchTools`) against a
 * minimal fake `McpServer` that just captures `server.tool(name, ..., handler)`
 * calls, then invokes the captured handlers directly with already-validated
 * args (mirroring what the real MCP SDK does after zod validation) — the
 * same approach `registerTool.ts` documents its handler signature for.
 *
 * Uses a real in-memory SQLite DB and a mock embedding provider, following
 * the pattern established in tests/mcpTools.test.ts.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest'

vi.mock('../src/core/db/sqlite.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/db/sqlite.js')>()
  const inMemorySession = actual.openDatabaseAt(':memory:')
  return {
    ...actual,
    getActiveSession: () => inMemorySession,
    db: inMemorySession.db,
  }
})

const MOCK_VEC = [0.1, 0.2, 0.3, 0.4]
function mockProviderFor(model: string) {
  return {
    model,
    embed: async () => [...MOCK_VEC],
    embedBatch: async (texts: string[]) => texts.map(() => [...MOCK_VEC]),
    dimensions: 4,
  }
}

vi.mock('../src/core/embedding/providerFactory.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/embedding/providerFactory.js')>()
  return {
    ...actual,
    getTextProvider: () => mockProviderFor('mock-text'),
    getCodeProvider: () => mockProviderFor('mock-code'),
    buildProviderForRequest: ((override: { model?: string; textModel?: string; codeModel?: string }, role: 'text' | 'code') => {
      if (role === 'text') return mockProviderFor(override.textModel ?? override.model ?? 'mock-text-override')
      return mockProviderFor(override.codeModel ?? override.model ?? 'mock-code-override')
    }) as any,
  }
})

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerSearchTools } from '../src/mcp/tools/search.js'

type ToolHandler = (args: any) => Promise<{ content: Array<{ type: string; text: string }> }>

function buildFakeServer(): { server: McpServer; handlers: Map<string, ToolHandler> } {
  const handlers = new Map<string, ToolHandler>()
  const server = {
    tool: (name: string, _description: string, _schema: unknown, handler: ToolHandler) => {
      handlers.set(name, handler)
    },
  } as unknown as McpServer
  return { server, handlers }
}

let handlers: Map<string, ToolHandler>

beforeAll(() => {
  const fake = buildFakeServer()
  registerSearchTools(fake.server)
  handlers = fake.handlers
})

async function callTool(name: string, args: Record<string, unknown>) {
  const handler = handlers.get(name)
  if (!handler) throw new Error(`tool not registered: ${name}`)
  return handler(args)
}

// ===========================================================================
// semantic_search — Phase 138 restored flags
// ===========================================================================
describe('MCP semantic_search — Phase 138 flag parity (empty DB)', () => {
  const base = { query: 'authentication', top_k: 5 }

  it('accepts level=module', async () => {
    const res = await callTool('semantic_search', { ...base, level: 'module' })
    expect(res.content[0].type).toBe('text')
  })

  it('returns per-level sections when 2+ levels are active', async () => {
    const res = await callTool('semantic_search', { ...base, level: 'symbol', chunks: true })
    const text = res.content[0].text
    expect(text).toContain('== file ==')
    expect(text).toContain('== chunk ==')
    expect(text).toContain('== symbol ==')
  })

  it('returns one merged list when merge_levels=true even with 2+ levels active', async () => {
    const res = await callTool('semantic_search', { ...base, level: 'symbol', chunks: true, merge_levels: true })
    const text = res.content[0].text
    expect(text).not.toContain('== file ==')
  })

  it('accepts not_like/lambda (negative example scoring)', async () => {
    const res = await callTool('semantic_search', { ...base, not_like: 'legacy code', lambda: 0.3 })
    expect(res.content[0].type).toBe('text')
  })

  it('accepts or/and boolean composition', async () => {
    const resOr = await callTool('semantic_search', { ...base, or: 'login' })
    expect(resOr.content[0].type).toBe('text')
    const resAnd = await callTool('semantic_search', { ...base, and: 'session' })
    expect(resAnd.content[0].type).toBe('text')
  })

  it('accepts explain flag', async () => {
    const res = await callTool('semantic_search', { ...base, explain: true })
    expect(res.content[0].type).toBe('text')
  })

  it('accepts explain_llm flag and appends provenance citations for results', async () => {
    const res = await callTool('semantic_search', { ...base, explain_llm: true })
    // Empty DB → no results → no citation block, but must not throw
    expect(res.content[0].type).toBe('text')
  })

  it('accepts expand_query flag', async () => {
    const res = await callTool('semantic_search', { ...base, expand_query: true })
    expect(res.content[0].type).toBe('text')
  })

  it('accepts annotate_clusters flag', async () => {
    const res = await callTool('semantic_search', { ...base, annotate_clusters: true })
    expect(res.content[0].type).toBe('text')
  })

  it('accepts vss flag', async () => {
    const res = await callTool('semantic_search', { ...base, vss: true })
    expect(res.content[0].type).toBe('text')
  })

  it('accepts early_cut flag', async () => {
    const res = await callTool('semantic_search', { ...base, early_cut: 50 })
    expect(res.content[0].type).toBe('text')
  })

  it('accepts no_cache flag', async () => {
    const res = await callTool('semantic_search', { ...base, no_cache: true })
    expect(res.content[0].type).toBe('text')
  })

  it('accepts repos param (multi-repo, no repos registered)', async () => {
    const res = await callTool('semantic_search', { ...base, repos: ['repo-a', 'repo-b'] })
    expect(res.content[0].type).toBe('text')
  })

  it('accepts model/text_model/code_model overrides without throwing', async () => {
    const res = await callTool('semantic_search', { ...base, text_model: 'override-text', code_model: 'override-code' })
    expect(res.content[0].type).toBe('text')
  })
})

// ===========================================================================
// first_seen — Phase 138 restored flags
// ===========================================================================
describe('MCP first_seen — Phase 138 flag parity (empty DB)', () => {
  it('accepts vss flag', async () => {
    const res = await callTool('first_seen', { query: 'authentication', vss: true })
    expect(res.content[0].type).toBe('text')
  })

  it('accepts repos param (multi-repo, no repos registered)', async () => {
    const res = await callTool('first_seen', { query: 'authentication', repos: ['repo-a'] })
    expect(res.content[0].type).toBe('text')
  })

  it('accepts model/text_model overrides without throwing', async () => {
    const res = await callTool('first_seen', { query: 'authentication', text_model: 'override-text' })
    expect(res.content[0].type).toBe('text')
  })
})
