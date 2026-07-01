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
import { mapModelLevelToSearchLevel, unionModelLevels, resolveExtraLevels, isMultiLevelActive } from '../src/cli/commands/search.js'

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

describe('unionModelLevels (search, dual-model)', () => {
  // vectorSearch()'s searchChunks/searchSymbols/searchModules flags are
  // additive (one call merges file + chunk + symbol + module candidates
  // into a single ranked pool) — so unlike the indexing side (one chunker
  // per run, no choice but to pick a winner), search can and should honor
  // both models' saved levels at once rather than treating a disagreement
  // as a conflict to give up on.
  it('resolves nothing when neither model has a level', () => {
    expect(unionModelLevels(undefined, undefined)).toEqual({
      searchChunks: false, searchSymbols: false, searchModules: false, resolved: false,
    })
  })

  it('uses the text level when only it is set', () => {
    expect(unionModelLevels('chunk', undefined)).toEqual({
      searchChunks: true, searchSymbols: false, searchModules: false, resolved: true,
    })
  })

  it('uses the code level when only it is set', () => {
    expect(unionModelLevels(undefined, 'symbol')).toEqual({
      searchChunks: false, searchSymbols: true, searchModules: false, resolved: true,
    })
  })

  it('unions both levels when the two models disagree, instead of picking one', () => {
    expect(unionModelLevels('chunk', 'symbol')).toEqual({
      searchChunks: true, searchSymbols: true, searchModules: false, resolved: true,
    })
  })

  it('marks resolved without setting any flag when a model wants plain file-level', () => {
    // 'file' needs no flag — it's always included in vectorSearch()'s base pool —
    // but this must still short-circuit the embed_config auto-recall fallback.
    expect(unionModelLevels('file', undefined)).toEqual({
      searchChunks: false, searchSymbols: false, searchModules: false, resolved: true,
    })
  })

  it('unions all three flags when both models plus a base level are all distinct', () => {
    expect(unionModelLevels('chunk', 'module')).toEqual({
      searchChunks: true, searchSymbols: false, searchModules: true, resolved: true,
    })
  })
})

describe('resolveExtraLevels / isMultiLevelActive (search, Phase 136 distinct per-level lists)', () => {
  it('returns no extra levels when none of the flags are set', () => {
    expect(resolveExtraLevels(false, false, false)).toEqual([])
  })

  it('returns one isolated chunk-level spec when only searchChunks is set', () => {
    const levels = resolveExtraLevels(true, false, false)
    expect(levels).toEqual([
      { name: 'chunk', flags: { searchChunks: true, searchSymbols: false, searchModules: false, includeFiles: false } },
    ])
    expect(isMultiLevelActive(levels)).toBe(false)
  })

  it('returns one isolated symbol-level spec when only searchSymbols is set', () => {
    const levels = resolveExtraLevels(false, true, false)
    expect(levels).toEqual([
      { name: 'symbol', flags: { searchChunks: false, searchSymbols: true, searchModules: false, includeFiles: false } },
    ])
    expect(isMultiLevelActive(levels)).toBe(false)
  })

  it('returns one isolated module-level spec when only searchModules is set', () => {
    const levels = resolveExtraLevels(false, false, true)
    expect(levels).toEqual([
      { name: 'module', flags: { searchChunks: false, searchSymbols: false, searchModules: true, includeFiles: false } },
    ])
    expect(isMultiLevelActive(levels)).toBe(false)
  })

  it('marks multi-level active when chunk and symbol are both set (e.g. --chunks --level symbol)', () => {
    const levels = resolveExtraLevels(true, true, false)
    expect(levels.map((l) => l.name)).toEqual(['chunk', 'symbol'])
    expect(isMultiLevelActive(levels)).toBe(true)
  })

  it('marks multi-level active when all three levels are set', () => {
    const levels = resolveExtraLevels(true, true, true)
    expect(levels.map((l) => l.name)).toEqual(['chunk', 'symbol', 'module'])
    expect(isMultiLevelActive(levels)).toBe(true)
  })

  it('each extra level isolates its pool via includeFiles: false and only its own flag', () => {
    for (const level of resolveExtraLevels(true, true, true)) {
      expect(level.flags.includeFiles).toBe(false)
      const trueFlags = [level.flags.searchChunks, level.flags.searchSymbols, level.flags.searchModules].filter(Boolean)
      expect(trueFlags).toEqual([true])
    }
  })
})
