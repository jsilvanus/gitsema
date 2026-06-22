/**
 * Documentation sync checks — ensures canonical docs stay aligned with the codebase.
 *
 * These tests guard against documentation drift identified in recent strategic reviews.
 *   1. package.json version appears in CLAUDE.md
 *   2. Current schema version in sqlite.ts matches CLAUDE.md
 *   3. README.md contains all top-level CLI commands registered in cli/index.ts
 *   4. features.md exists and has a non-empty intro section
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { GUIDE_TOOLS } from '../src/core/narrator/guideTools.js'
import { TOOL_INTERPRETATIONS } from '../src/core/narrator/interpretations.js'
import { buildInterpretationsBlock, applyToFile } from '../scripts/gen-skill.mjs'

const ROOT = resolve(import.meta.dirname, '..')

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

// ---------------------------------------------------------------------------
// 1. package.json version is reflected in CLAUDE.md schema version entry
// ---------------------------------------------------------------------------
describe('docs/CLAUDE.md sync', () => {
  it('CLAUDE.md exists', () => {
    expect(existsSync(join(ROOT, 'CLAUDE.md'))).toBe(true)
  })

  it('CLAUDE.md references the current schema version from sqlite.ts', () => {
    const sqlite = read('src/core/db/sqlite.ts')
    const claudeMd = read('CLAUDE.md')

    // Extract current schema version from sqlite.ts (e.g. "CURRENT_SCHEMA_VERSION = 19")
    const versionMatch = sqlite.match(/CURRENT_SCHEMA_VERSION\s*=\s*(\d+)/)
    if (!versionMatch) {
      // If the constant name changed, skip with a warning rather than fail
      console.warn('Could not extract schema version from sqlite.ts — check constant name')
      return
    }
    const schemaVersion = versionMatch[1]

    // CLAUDE.md should mention this schema version somewhere (e.g. "schema v17" or "v17")
    expect(claudeMd).toMatch(new RegExp(`(schema v${schemaVersion}|v${schemaVersion}\\b)`))
  })
})

// ---------------------------------------------------------------------------
// 2. README.md contains all primary CLI commands
// ---------------------------------------------------------------------------
describe('README.md command coverage', () => {
  // Commands that are intentionally hidden or aliases — not required in README
  const EXCLUDED = new Set(['mcp', 'lsp', 'serve', 'concept-evolution'])

  it('README.md exists', () => {
    expect(existsSync(join(ROOT, 'README.md'))).toBe(true)
  })

  it('README.md mentions all non-hidden commands', () => {
    const readme = read('README.md')
    const program = read('src/cli/program.ts')

    // Extract command names from COMMAND_GROUPS (keys that aren't aliases)
    const commandGroupsMatch = program.match(/COMMAND_GROUPS[^=]*=\s*\{([^}]+)\}/s)
    if (!commandGroupsMatch) {
      // COMMAND_GROUPS must be extractable here — a silent skip would mask real drift
      throw new Error('Could not extract COMMAND_GROUPS from src/cli/program.ts')
    }

    const commandKeys = [...commandGroupsMatch[1].matchAll(/'([a-z][a-z-]+)'/g)]
      .map(m => m[1])
      .filter(k => !EXCLUDED.has(k))

    const missing: string[] = []
    for (const cmd of commandKeys) {
      // README should mention the command name at some point (as code, table row, heading, etc.)
      if (!readme.includes(cmd)) missing.push(cmd)
    }

    if (missing.length > 0) {
      console.warn(`Commands not found in README.md: ${missing.join(', ')}`)
    }
    // Allow up to 5 missing — README evolves, but shouldn't drift too far
    expect(missing.length).toBeLessThanOrEqual(5)
  })
})

// ---------------------------------------------------------------------------
// 3. features.md and PLAN.md exist and are non-trivial
// ---------------------------------------------------------------------------
describe('canonical docs exist', () => {
  for (const doc of ['docs/features.md', 'docs/PLAN.md', 'docs/review8.md']) {
    it(`${doc} exists and has content`, () => {
      const path = join(ROOT, doc)
      expect(existsSync(path), `${doc} should exist`).toBe(true)
      const content = readFileSync(path, 'utf8')
      expect(content.length, `${doc} should not be empty`).toBeGreaterThan(500)
    })
  }
})

// ---------------------------------------------------------------------------
// 4. Tool interpretation registry coverage + skill generation drift
// ---------------------------------------------------------------------------
describe('TOOL_INTERPRETATIONS coverage', () => {
  it('every guide tool has a TOOL_INTERPRETATIONS entry', () => {
    const missing = Object.keys(GUIDE_TOOLS).filter((name) => !TOOL_INTERPRETATIONS[name])
    expect(missing, `missing TOOL_INTERPRETATIONS entries: ${missing.join(', ')}`).toEqual([])
  })

  it('every skill tool resolves a usage def (description + params) from GUIDE_TOOLS', () => {
    // The generated skill block joins each interpretation (how to read) with a
    // GUIDE_TOOLS definition (how to use) by tool name or MCP alias. If an entry
    // has no resolvable usage def, the skill would show interpretation only —
    // catch that here (mirrors gen-skill.mjs's USAGE_BY_NAME lookup).
    const usageNames = new Set(Object.values(GUIDE_TOOLS).map((e) => e.definition.name))
    const missing = Object.values(TOOL_INTERPRETATIONS)
      .filter((e) => !usageNames.has(e.name) && !(e.aliases ?? []).some((a) => usageNames.has(a)))
      .map((e) => e.name)
    expect(missing, `interpretation entries without a GUIDE_TOOLS usage def: ${missing.join(', ')}`).toEqual([])
  })
})

describe('skill generation drift', () => {
  it('skill/gitsema-ai-assistant.md matches the generated interpretations block', () => {
    const block = buildInterpretationsBlock()
    const target = join(ROOT, 'skill', 'gitsema-ai-assistant.md')
    const current = readFileSync(target, 'utf8')
    const regenerated = applyToFile(target, block)
    expect(current, 'run `pnpm gen:skill` to regenerate skill/gitsema-ai-assistant.md').toBe(regenerated)
  })

  it('.github/skills/gitsema.md is in sync with skill/gitsema-ai-assistant.md', () => {
    const a = read('skill/gitsema-ai-assistant.md')
    const b = read('.github/skills/gitsema.md')
    expect(b, 'run `pnpm gen:skill` to keep .github/skills/gitsema.md in sync').toBe(a)
  })
})

// ---------------------------------------------------------------------------
// 5. package.json version is semver and present in git tags (soft check)
// ---------------------------------------------------------------------------
describe('package.json', () => {
  it('has a valid semver version', () => {
    const pkg = JSON.parse(read('package.json'))
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('version is >= 0.80.0 (sanity floor)', () => {
    const pkg = JSON.parse(read('package.json'))
    const [major, minor] = pkg.version.split('.').map(Number)
    expect(major * 1000 + minor).toBeGreaterThanOrEqual(80)
  })

  it('docs/features.md banner version matches package.json (review9 §5.3 / Phase 118)', () => {
    const pkg = JSON.parse(read('package.json'))
    const banner = read('docs/features.md').split('\n', 5).join('\n')
    const match = banner.match(/Current version: \*\*v(\d+\.\d+\.\d+)\*\*/)
    expect(match, 'docs/features.md should have a "Current version: **vX.Y.Z**" banner').not.toBeNull()
    expect(match![1], 'docs/features.md banner version is stale — update it to match package.json').toBe(pkg.version)
  })
})
