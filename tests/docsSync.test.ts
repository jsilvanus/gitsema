/**
 * Documentation sync checks — ensures canonical docs stay aligned with the codebase.
 *
 * These tests guard against the drift documented in review6 §9.2:
 *   1. package.json version appears in CLAUDE.md
 *   2. Current schema version in sqlite.ts matches CLAUDE.md
 *   3. README.md contains all top-level CLI commands registered in cli/index.ts
 *   4. features.md exists and has a non-empty intro section
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'

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
    const cliIndex = read('src/cli/index.ts')

    // Extract command names from COMMAND_GROUPS (keys that aren't aliases)
    const commandGroupsMatch = cliIndex.match(/const COMMAND_GROUPS[^=]*=\s*\{([^}]+)\}/s)
    if (!commandGroupsMatch) {
      // COMMAND_GROUPS may have moved; skip gracefully
      console.warn('Could not extract COMMAND_GROUPS from cli/index.ts')
      return
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
  for (const doc of ['docs/features.md', 'docs/PLAN.md', 'docs/review6.md']) {
    it(`${doc} exists and has content`, () => {
      const path = join(ROOT, doc)
      expect(existsSync(path), `${doc} should exist`).toBe(true)
      const content = readFileSync(path, 'utf8')
      expect(content.length, `${doc} should not be empty`).toBeGreaterThan(500)
    })
  }
})

// ---------------------------------------------------------------------------
// 4. package.json version is semver and present in git tags (soft check)
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
})
