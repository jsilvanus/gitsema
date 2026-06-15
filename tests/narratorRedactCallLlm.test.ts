/**
 * Redaction regression test for the per-result narrators (review9 §3).
 *
 * The bespoke `narrate*` helpers in src/core/llm/narrator.ts build prompts from
 * repo content (paths, queries, snippets) and call the shared `callLlm`. This
 * test verifies that secrets in that content are redacted before the request
 * leaves the process — the guarantee now enforced at the `callLlm` chokepoint.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { narrateSearchResults } from '../src/core/llm/narrator.js'
import type { SearchResult } from '../src/core/models/types.js'

const SECRET = 'ghp_' + 'a'.repeat(36) // matches the github-pat redaction pattern

describe('callLlm redaction (via narrateSearchResults)', () => {
  let captured: string | undefined
  const origUrl = process.env.GITSEMA_LLM_URL

  beforeEach(() => {
    captured = undefined
    process.env.GITSEMA_LLM_URL = 'http://llm.example.invalid'
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      captured = typeof init?.body === 'string' ? init.body : undefined
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (origUrl === undefined) delete process.env.GITSEMA_LLM_URL
    else process.env.GITSEMA_LLM_URL = origUrl
  })

  it('redacts secrets embedded in result paths before sending', async () => {
    const results: SearchResult[] = [
      { blobHash: 'a'.repeat(40), paths: [`config/${SECRET}.ts`], score: 0.9 } as SearchResult,
    ]
    const out = await narrateSearchResults('find auth', results)

    expect(out).toBe('ok')
    expect(captured).toBeDefined()
    expect(captured!).not.toContain(SECRET)
    expect(captured!).toContain('[REDACTED:github-pat]')
  })
})
