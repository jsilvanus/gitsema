/**
 * Phase 77 Goal #4: a saved per-model `--level` (`gitsema models add <name>
 * --level ...`) should act as a fallback default for `index start`'s
 * `--chunker` and `search`'s `--level`, when the user passed no explicit
 * flag. Unit tests for the two pure resolution helpers (the surrounding CLI
 * commands require a full provider/DB setup and are covered at the
 * integration level elsewhere).
 */

import { describe, it, expect } from 'vitest'
import { resolveModelLevelChunker } from '../src/cli/commands/index.js'
import { mapModelLevelToSearchLevel } from '../src/cli/commands/search.js'

describe('resolveModelLevelChunker (index start)', () => {
  it('returns undefined when neither model has a saved level', () => {
    expect(resolveModelLevelChunker(undefined, undefined)).toEqual({ chunker: undefined })
  })

  it('uses the text model level when only it is set', () => {
    expect(resolveModelLevelChunker('function', undefined)).toEqual({ chunker: 'function' })
  })

  it('uses the code model level when only it is set', () => {
    expect(resolveModelLevelChunker(undefined, 'fixed')).toEqual({ chunker: 'fixed' })
  })

  it('uses the agreed level when both models match', () => {
    expect(resolveModelLevelChunker('function', 'function')).toEqual({ chunker: 'function' })
  })

  it('maps blob to the file chunker', () => {
    expect(resolveModelLevelChunker('blob', 'blob')).toEqual({ chunker: 'file' })
  })

  it('returns a conflict descriptor instead of guessing when the two models disagree', () => {
    const result = resolveModelLevelChunker('function', 'fixed')
    expect(result.chunker).toBeUndefined()
    expect(result.conflict).toEqual({ textLevel: 'function', codeLevel: 'fixed' })
  })

  it('does not conflict on search-only level values shared by both models', () => {
    // 'chunk'/'symbol'/'module' aren't in LEVEL_TO_CHUNKER (they're search-only
    // levels) — agreeing on one still shouldn't guess a chunker.
    expect(resolveModelLevelChunker('symbol', 'symbol')).toEqual({ chunker: undefined })
  })
})

describe('mapModelLevelToSearchLevel (search)', () => {
  it('returns undefined for an unset level', () => {
    expect(mapModelLevelToSearchLevel(undefined)).toBeUndefined()
  })

  it('maps indexing-side levels to their search-level equivalents', () => {
    expect(mapModelLevelToSearchLevel('blob')).toBe('file')
    expect(mapModelLevelToSearchLevel('file')).toBe('file')
    expect(mapModelLevelToSearchLevel('function')).toBe('chunk')
    expect(mapModelLevelToSearchLevel('fixed')).toBe('chunk')
  })

  it('passes already-search-native levels through unchanged', () => {
    expect(mapModelLevelToSearchLevel('chunk')).toBe('chunk')
    expect(mapModelLevelToSearchLevel('symbol')).toBe('symbol')
    expect(mapModelLevelToSearchLevel('module')).toBe('module')
  })
})
