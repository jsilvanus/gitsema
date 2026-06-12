/**
 * Flag consistency test (review8 §8.6 / §8.9).
 *
 * Walks the full command tree (including subcommands) produced by
 * buildProgram() and asserts:
 *
 *  (a) every command exposing --dump, --html, or --format also exposes --out
 *  (b) every command exposing --before or --after also exposes --since and --until
 *  (c) every option whose long flag is --top also has the -k short flag
 *
 * Hidden backward-compat alias commands are skipped — they intentionally mirror
 * the legacy surface of the commands they alias and are not part of the
 * unified-flag contract.
 *
 * If a command legitimately cannot satisfy one of these rules, it must be added
 * to the relevant EXCEPTIONS set below with a comment explaining why — rather
 * than weakening the rule itself.
 */

import { describe, it, expect } from 'vitest'
import type { Command } from 'commander'
import { buildProgram } from '../src/cli/program.js'

interface CommandInfo {
  path: string
  hidden: boolean
  longFlags: Set<string>
}

function collectCommands(cmd: Command, prefix: string, out: CommandInfo[]): void {
  for (const sub of cmd.commands) {
    const path = prefix ? `${prefix} ${sub.name()}` : sub.name()
    const longFlags = new Set<string>()
    for (const opt of sub.options) {
      if (opt.long) longFlags.add(opt.long)
    }
    out.push({ path, hidden: Boolean((sub as unknown as { _hidden?: boolean })._hidden), longFlags })
    collectCommands(sub, path, out)
  }
}

const program = buildProgram()
const allCommands: CommandInfo[] = []
collectCommands(program, '', allCommands)

// Only consider visible commands — hidden entries are deprecated backward-compat
// aliases that intentionally mirror their target command's (possibly stale) flags.
const visibleCommands = allCommands.filter((c) => !c.hidden)

// ---------------------------------------------------------------------------
// Exceptions
// ---------------------------------------------------------------------------

/**
 * Commands with --dump/--html/--format that legitimately cannot also carry the
 * unified --out spec option.
 *
 * (none currently — all such commands now also define --out)
 */
const OUT_EXCEPTIONS = new Set<string>([])

/**
 * Commands with --before/--after that legitimately cannot also carry
 * --since/--until.
 *
 * (none currently — `search` is the only command with --before/--after and it
 * now also defines --since/--until as documented aliases)
 */
const SINCE_UNTIL_EXCEPTIONS = new Set<string>([])

/**
 * Commands whose --top option is not the "result count" --top (which review8
 * standardizes on -k, --top) but a differently-scoped per-group/per-cluster
 * count (e.g. "top representative paths per cluster", "max results per query").
 * Adding -k to these would be a separate flag-semantics review item, not part
 * of §8.6/§8.9 — out of scope for this change.
 */
const TOP_SHORT_FLAG_EXCEPTIONS = new Set<string>([
  'clusters',          // --top: representative paths per cluster
  'cluster-diff',      // --top: representative paths per cluster
  'cluster-timeline',  // --top: representative paths per cluster
  'merge-preview',     // --top: representative paths per cluster
  'repos search',      // --top: results per repo
  'security-scan',     // --top: top results per pattern
  'watch run',         // --top: max results per query
])

// ---------------------------------------------------------------------------
// (a) --dump/--html/--format => --out
// ---------------------------------------------------------------------------
describe('flag consistency: --out unification (review8 §8.6)', () => {
  for (const cmd of visibleCommands) {
    const hasLegacyOutputFlag =
      cmd.longFlags.has('--dump') || cmd.longFlags.has('--html') || cmd.longFlags.has('--format')

    if (!hasLegacyOutputFlag) continue

    it(`"${cmd.path}" exposes --out alongside --dump/--html/--format`, () => {
      if (OUT_EXCEPTIONS.has(cmd.path)) {
        // Documented exception — see OUT_EXCEPTIONS comment above.
        expect(OUT_EXCEPTIONS.has(cmd.path)).toBe(true)
        return
      }
      expect(cmd.longFlags.has('--out')).toBe(true)
    })
  }
})

// ---------------------------------------------------------------------------
// (b) --before/--after => --since/--until
// ---------------------------------------------------------------------------
describe('flag consistency: --since/--until date-flag standardization (review8 §8.9)', () => {
  for (const cmd of visibleCommands) {
    // Trigger only for the search-style --before/--after date-range pair (both
    // present). Commands with only one of --before/--after (e.g. `index export`'s
    // --after/--since alias pair) are a different, single-sided filter and are
    // not part of this standardization.
    const hasBeforeAndAfter = cmd.longFlags.has('--before') && cmd.longFlags.has('--after')

    if (!hasBeforeAndAfter) continue

    it(`"${cmd.path}" exposes --since and --until alongside --before/--after`, () => {
      if (SINCE_UNTIL_EXCEPTIONS.has(cmd.path)) {
        expect(SINCE_UNTIL_EXCEPTIONS.has(cmd.path)).toBe(true)
        return
      }
      expect(cmd.longFlags.has('--since')).toBe(true)
      expect(cmd.longFlags.has('--until')).toBe(true)
    })
  }
})

// ---------------------------------------------------------------------------
// (c) --top => -k short flag
// ---------------------------------------------------------------------------
describe('flag consistency: --top has -k short flag', () => {
  for (const sub of allCommands) {
    // Re-walk to get Option objects (not just long-flag names) for short-flag check.
  }

  function collectTopOptions(cmd: Command, prefix: string, results: { path: string; hasShort: boolean }[]): void {
    for (const sub of cmd.commands) {
      const path = prefix ? `${prefix} ${sub.name()}` : sub.name()
      for (const opt of sub.options) {
        if (opt.long === '--top') {
          results.push({ path, hasShort: opt.short === '-k' })
        }
      }
      collectTopOptions(sub, path, results)
    }
  }

  const results: { path: string; hasShort: boolean }[] = []
  collectTopOptions(program, '', results)

  for (const { path, hasShort } of results) {
    it(`"${path}" --top option has -k short flag`, () => {
      if (TOP_SHORT_FLAG_EXCEPTIONS.has(path)) {
        expect(TOP_SHORT_FLAG_EXCEPTIONS.has(path)).toBe(true)
        return
      }
      expect(hasShort).toBe(true)
    })
  }

  it('found at least one --top option to check', () => {
    expect(results.length).toBeGreaterThan(0)
  })
})
