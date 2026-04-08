/**
 * MCP tool parity tests — INTENTIONALLY FAILING.
 *
 * These tests assert that every CLI/HTTP analysis command also has an MCP tool
 * registered in src/mcp/server.ts.
 *
 * Per docs/review5.md §3 ("Missing HTTP Routes"), the following MCP tools are
 * called out as absent:
 *
 *   doc_gap            — gitsema doc-gap (CLI only)
 *   contributor_profile — gitsema contributor-profile (CLI only)
 *   triage             — gitsema triage <query> (CLI only)
 *   policy_check       — gitsema policy check (CLI only)
 *   ownership          — gitsema ownership <query> (CLI only)
 *   workflow_run       — gitsema workflow run <template> (CLI only)
 *   eval               — gitsema eval (CLI only)
 *
 * Do NOT change these to `it.skip` — the failures are the mechanism that keeps
 * CI red until parity is achieved.
 *
 * Strategy: parse the MCP server source file to confirm each expected tool name
 * appears as a registered tool. This is intentionally simple — if the tool name
 * is not in the server, the test fails with a clear message.
 *
 * See docs/review5.md §3 for the full parity table.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

// ---------------------------------------------------------------------------
// Load MCP server source once
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const SERVER_SRC = readFileSync(
  join(__dirname, '../src/mcp/server.ts'),
  'utf8',
)

/**
 * Returns true if `toolName` appears as the first positional argument to a
 * `server.tool(...)` call in the MCP server source.
 */
function isMcpToolRegistered(toolName: string): boolean {
  // Match:  server.tool(\n?  'toolName'  or  "toolName"
  const pattern = new RegExp(`server\\.tool\\(\\s*['"]${toolName}['"]`)
  return pattern.test(SERVER_SRC)
}

// ---------------------------------------------------------------------------
// Known-good tools (regression guard — these should never disappear)
// ---------------------------------------------------------------------------
describe('MCP tools that must remain registered (regression guard)', () => {
  const existingTools = [
    'semantic_search',
    'code_search',
    'search_history',
    'first_seen',
    'evolution',
    'concept_evolution',
    'index',
    'branch_summary',
    'merge_audit',
    'merge_preview',
    'clusters',
    'change_points',
    'experts',
    'semantic_diff',
    'semantic_blame',
    'file_change_points',
    'cluster_diff',
    'cluster_timeline',
    'author',
    'impact',
    'dead_concepts',
    'security_scan',
    'health_timeline',
    'debt_score',
    'multi_repo_search',
  ]

  for (const toolName of existingTools) {
    it(`'${toolName}' is registered`, () => {
      expect(
        isMcpToolRegistered(toolName),
        `MCP tool '${toolName}' was found in src/mcp/server.ts before but is now missing. ` +
        `Do not remove existing tool registrations.`,
      ).toBe(true)
    })
  }
})

// ---------------------------------------------------------------------------
// Missing tools — these FAIL until registered
// ---------------------------------------------------------------------------
describe('MCP tools missing from server.ts [PARITY GAP — INTENTIONALLY FAILING]', () => {
  it(
    "'doc_gap' MCP tool must be registered — FAILS until added to src/mcp/server.ts",
    () => {
      expect(
        isMcpToolRegistered('doc_gap'),
        "MCP tool 'doc_gap' is not registered in src/mcp/server.ts. " +
        'Add a server.tool(\'doc_gap\', ...) handler that calls computeDocGap(). ' +
        'See docs/review5.md §3.',
      ).toBe(true)
    },
  )

  it(
    "'contributor_profile' MCP tool must be registered — FAILS until added to src/mcp/server.ts",
    () => {
      expect(
        isMcpToolRegistered('contributor_profile'),
        "MCP tool 'contributor_profile' is not registered in src/mcp/server.ts. " +
        'Add a server.tool(\'contributor_profile\', ...) handler that calls computeContributorProfile(). ' +
        'See docs/review5.md §3.',
      ).toBe(true)
    },
  )

  it(
    "'triage' MCP tool must be registered — FAILS until added to src/mcp/server.ts",
    () => {
      expect(
        isMcpToolRegistered('triage'),
        "MCP tool 'triage' is not registered in src/mcp/server.ts. " +
        'Add a server.tool(\'triage\', ...) handler that calls triageCommand() core logic. ' +
        'See docs/review5.md §3.',
      ).toBe(true)
    },
  )

  it(
    "'policy_check' MCP tool must be registered — FAILS until added to src/mcp/server.ts",
    () => {
      expect(
        isMcpToolRegistered('policy_check'),
        "MCP tool 'policy_check' is not registered in src/mcp/server.ts. " +
        'Add a server.tool(\'policy_check\', ...) handler that calls runPolicyCheck() core logic. ' +
        'See docs/review5.md §3.',
      ).toBe(true)
    },
  )

  it(
    "'ownership' MCP tool must be registered — FAILS until added to src/mcp/server.ts",
    () => {
      expect(
        isMcpToolRegistered('ownership'),
        "MCP tool 'ownership' is not registered in src/mcp/server.ts. " +
        'Add a server.tool(\'ownership\', ...) handler that calls computeOwnershipHeatmap(). ' +
        'See docs/review5.md §3.',
      ).toBe(true)
    },
  )

  it(
    "'workflow_run' MCP tool must be registered — FAILS until added to src/mcp/server.ts",
    () => {
      expect(
        isMcpToolRegistered('workflow_run'),
        "MCP tool 'workflow_run' is not registered in src/mcp/server.ts. " +
        'Add a server.tool(\'workflow_run\', ...) handler that calls workflowCommand() core logic. ' +
        'See docs/review5.md §3.',
      ).toBe(true)
    },
  )

  it(
    "'eval' MCP tool must be registered — FAILS until added to src/mcp/server.ts",
    () => {
      expect(
        isMcpToolRegistered('eval'),
        "MCP tool 'eval' is not registered in src/mcp/server.ts. " +
        'Add a server.tool(\'eval\', ...) handler that calls the eval harness core logic. ' +
        'See docs/review5.md §3.',
      ).toBe(true)
    },
  )
})

// ---------------------------------------------------------------------------
// Core function availability (smoke tests — these should always pass)
// Verifies that the underlying business logic exists even before MCP wiring.
//
// Note: vi.mock() calls are hoisted by Vitest to before any import statements,
// so the mocks are active before openDatabaseAt() is called at module scope.
// This matches the pattern used in tests/mcpTools.test.ts.
// ---------------------------------------------------------------------------
import { vi } from 'vitest'

// vi.mock() calls are hoisted before all imports by Vitest, so these mocks are
// established first, then openDatabaseAt uses the real implementation below.
import { openDatabaseAt } from '../src/core/db/sqlite.js'

const inMemorySession = openDatabaseAt(':memory:')

vi.mock('../src/core/db/sqlite.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/db/sqlite.js')>()
  return { ...actual, getActiveSession: () => inMemorySession }
})

const MOCK_VEC = [0.1, 0.2, 0.3, 0.4]
vi.mock('../src/core/embedding/providerFactory.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/embedding/providerFactory.js')>()
  const mockProvider = {
    model: 'mock',
    embed: async () => [...MOCK_VEC],
    embedBatch: async (texts: string[]) => texts.map(() => [...MOCK_VEC]),
    dimensions: 4,
  }
  return { ...actual, getTextProvider: () => mockProvider, getCodeProvider: () => undefined }
})

import { computeDocGap } from '../src/core/search/docGap.js'
import { computeContributorProfile } from '../src/core/search/contributorProfile.js'
import { computeOwnershipHeatmap } from '../src/core/search/ownershipHeatmap.js'

describe('Core functions for missing MCP tools exist and return stable shapes', () => {
  it('computeDocGap() returns an array on empty DB', async () => {
    const results = await computeDocGap({ topK: 5 })
    expect(Array.isArray(results)).toBe(true)
  })

  it('computeContributorProfile() returns an array on empty DB', async () => {
    const results = await computeContributorProfile('alice@example.com', { topK: 5 })
    expect(Array.isArray(results)).toBe(true)
  })

  it('computeOwnershipHeatmap() returns an array on empty DB', () => {
    const results = computeOwnershipHeatmap({ embedding: MOCK_VEC, topK: 5 })
    expect(Array.isArray(results)).toBe(true)
  })
})
