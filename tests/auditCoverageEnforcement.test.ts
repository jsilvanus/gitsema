/**
 * Audit log coverage enforcement (Phase 132 / docs/feature-ideas.md "Audit Log
 * Coverage Enforcement").
 *
 * `recordAuditEvent()` (src/core/auth/auditLog.ts) is wired into the routes
 * that exist today (auth.ts, orgs.ts), but nothing structurally enforces that
 * a *new* sensitive route calls it. This test performs static analysis over
 * every route handler in `src/server/routes/` and asserts that any handler
 * which writes to a sensitive table — via a known writer function imported
 * from `src/core/auth/*` — also contains a `recordAuditEvent(` call in the
 * same handler body, unless the handler+table pair is explicitly exempted
 * below with a documented rationale.
 *
 * This is deliberately a source-text check, not a runtime check: it has to
 * catch the gap *before* the route ever executes in CI or production.
 *
 * How it works:
 *   1. Map known writer functions (imported from src/core/auth/*) to the
 *      sensitive table they mutate.
 *   2. For each route file, find every `router.<method>(<path>, ...)` call
 *      and extract its handler body via brace matching.
 *   3. For each handler body, find which sensitive-table writer functions it
 *      calls.
 *   4. If a handler calls a sensitive writer but the body has no
 *      `recordAuditEvent(` call, the (file, method, path, table) combination
 *      must appear in EXEMPTIONS — otherwise the test fails with the table,
 *      route, and file/line so a future contributor can either add the audit
 *      call or add a justified exemption.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROUTES_DIR = join(__dirname, '..', 'src', 'server', 'routes')

/**
 * Maps writer functions (defined in src/core/auth/*.ts, imported by route
 * files) to the sensitive table each one mutates. Read-only lookups
 * (getUserById, listGrants, resolveUserRepoAccess, etc.) are intentionally
 * excluded — they don't write, so they're not in scope for audit coverage.
 */
const SENSITIVE_WRITERS: Record<string, string> = {
  createUser: 'users',
  createSession: 'sessions',
  revokeSession: 'sessions',
  createApiKey: 'api_keys',
  revokeApiKeyByPrefix: 'api_keys',
  addOrgMember: 'org_members',
  removeOrgMember: 'org_members',
  createGrant: 'repo_grants',
  revokeGrant: 'repo_grants',
  moveRepoToOrg: 'repo_grants',
  linkSsoIdentity: 'sso_identities',
  unlinkSsoIdentity: 'sso_identities',
}

interface RouteHandler {
  file: string
  method: string
  path: string
  body: string
  startLine: number
}

/**
 * Extracts every `router.<method>(<path>, ..., (req, res) => { ... })` (or
 * `async (req, res) => { ... }`) call from a route file's source, along with
 * the full handler body text (brace-matched) and its starting line number.
 *
 * This is intentionally a lightweight scanner, not a real parser — route
 * files in this codebase consistently follow the `router.METHOD(path, ...,
 * handler)` shape (see auth.ts, orgs.ts, remote.ts), so brace-matching from
 * the handler's opening `{` is sufficient and avoids pulling in a TS AST
 * dependency just for this test.
 */
function extractHandlers(file: string, source: string): RouteHandler[] {
  const handlers: RouteHandler[] = []
  const callRegex = /router\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]*)\2/g
  let match: RegExpExecArray | null
  while ((match = callRegex.exec(source)) !== null) {
    const method = match[1]
    const path = match[3]
    const callStart = match.index
    // Find the first `{` after the matched router.method(...) call opens —
    // this is the handler function body's opening brace.
    const bodyStart = source.indexOf('{', callRegex.lastIndex)
    if (bodyStart === -1) continue
    let depth = 0
    let bodyEnd = -1
    for (let i = bodyStart; i < source.length; i++) {
      if (source[i] === '{') depth++
      else if (source[i] === '}') {
        depth--
        if (depth === 0) {
          bodyEnd = i
          break
        }
      }
    }
    if (bodyEnd === -1) continue
    const body = source.slice(bodyStart, bodyEnd + 1)
    const startLine = source.slice(0, callStart).split('\n').length
    handlers.push({ file, method: method.toUpperCase(), path, body, startLine })
  }
  return handlers
}

/**
 * Explicit exemptions: (file, method, path, table) combinations that write
 * to a sensitive table without a `recordAuditEvent` call, with the rationale
 * for why audit coverage isn't required. Each entry must be justified — this
 * list should stay small and every addition should be deliberate, not a way
 * to silence the test.
 */
interface Exemption {
  file: string
  method: string
  path: string
  table: string
  reason: string
}

const EXEMPTIONS: Exemption[] = [
  {
    file: 'auth.ts',
    method: 'POST',
    path: '/logout',
    table: 'sessions',
    reason:
      'Session revocation on logout is a self-service action the caller initiates on their own ' +
      'session; login.success/login.failure already capture the security-relevant lifecycle events ' +
      'for this table. Revisit if session revocation needs to be attributable in the audit trail ' +
      '(e.g. admin-initiated forced logout).',
  },
  {
    file: 'auth.ts',
    method: 'DELETE',
    path: '/sso/:provider/:externalId',
    table: 'sso_identities',
    reason:
      'Self-service unlink of an SSO identity already linked to the caller\'s own account (ownership ' +
      'is checked before the unlink). Linking (the more sensitive direction) is CLI-only and not a ' +
      'route at all (see sso.ts header). Revisit if SSO identity changes need audit-trail visibility.',
  },
  {
    file: 'orgs.ts',
    method: 'POST',
    path: '/',
    table: 'org_members',
    reason:
      'Org creation auto-adds the creating user as org_admin of their own new org — this is initial ' +
      'self-membership, not a grant of access to another principal. The org.member.add audit action ' +
      'is reserved for adding *other* users to an org (see POST /:orgId/members below, which is ' +
      'audited). Revisit if org-creation events themselves need a dedicated audit action.',
  },
  {
    file: 'remote.ts',
    method: 'POST',
    path: '/index',
    table: 'repo_grants',
    reason:
      'Known gap (Phase 126 "attach-as-reader" auto-grant, public-repo-sharing §4.3): a non-owner ' +
      'caller indexing/re-indexing an already-registered public repo is auto-granted a read-only ' +
      'grant with source=\'auto-public\'. This is a real, tracked gap (not a deliberate design ' +
      'decision) — see docs/feature-ideas.md. Exempted here so Phase 132 doesn\'t silently widen its ' +
      'own enforcement net to cover a gap it isn\'t scoped to fix; remove this exemption once the ' +
      'auto-grant path gets a recordAuditEvent call.',
  },
]

function isExempt(file: string, method: string, path: string, table: string): boolean {
  return EXEMPTIONS.some((e) => e.file === file && e.method === method && e.path === path && e.table === table)
}

describe('audit log coverage enforcement', () => {
  const routeFiles = ['auth.ts', 'orgs.ts', 'remote.ts', 'blobs.ts', 'commits.ts', 'analysis.ts', 'search.ts', 'evolution.ts', 'graph.ts', 'guide.ts', 'narrator.ts', 'openapi.ts', 'projections.ts', 'protocol.ts', 'status.ts', 'watch.ts']

  it('every sensitive-table-writing route handler calls recordAuditEvent or has a documented exemption', () => {
    const violations: string[] = []
    let sensitiveHandlerCount = 0

    for (const file of routeFiles) {
      const fullPath = join(ROUTES_DIR, file)
      let source: string
      try {
        source = readFileSync(fullPath, 'utf-8')
      } catch {
        continue // route file doesn't exist in this checkout; skip
      }

      // Only scan files that actually import at least one known sensitive
      // writer — this keeps the test fast and avoids false negatives from
      // unrelated identifiers that happen to share a writer's name.
      const importedWriters = Object.keys(SENSITIVE_WRITERS).filter((fn) => {
        const importRegex = new RegExp(`import\\s*\\{[^}]*\\b${fn}\\b[^}]*\\}\\s*from\\s*['"\`][^'"\`]*core/auth/`)
        return importRegex.test(source)
      })
      if (importedWriters.length === 0) continue

      const handlers = extractHandlers(file, source)
      for (const handler of handlers) {
        const tablesWritten = new Set<string>()
        for (const fn of importedWriters) {
          // Match the writer as a function call within this handler body.
          const callPattern = new RegExp(`\\b${fn}\\s*\\(`)
          if (callPattern.test(handler.body)) {
            tablesWritten.add(SENSITIVE_WRITERS[fn])
          }
        }
        if (tablesWritten.size === 0) continue

        sensitiveHandlerCount++
        const hasAudit = /\brecordAuditEvent\s*\(/.test(handler.body)
        if (hasAudit) continue

        for (const table of tablesWritten) {
          if (isExempt(file, handler.method, handler.path, table)) continue
          violations.push(
            `${file}:${handler.startLine} ${handler.method} ${handler.path} writes to sensitive table ` +
              `'${table}' but has no recordAuditEvent() call and no matching entry in EXEMPTIONS. ` +
              `Either add a recordAuditEvent(...) call inside this handler, or add a justified ` +
              `EXEMPTIONS entry { file: '${file}', method: '${handler.method}', path: '${handler.path}', ` +
              `table: '${table}', reason: '...' } in tests/auditCoverageEnforcement.test.ts.`,
          )
        }
      }
    }

    // Sanity check that the scanner is actually finding the routes we expect
    // it to find — guards against a regex change silently making this test
    // vacuously true.
    expect(sensitiveHandlerCount).toBeGreaterThanOrEqual(8)

    expect(violations, violations.join('\n')).toEqual([])
  })

  it('every EXEMPTIONS entry has a non-empty rationale and refers to an existing route file', () => {
    for (const e of EXEMPTIONS) {
      expect(e.reason.trim().length, `exemption for ${e.file} ${e.method} ${e.path} (${e.table}) has no reason`).toBeGreaterThan(20)
      expect(() => readFileSync(join(ROUTES_DIR, e.file), 'utf-8'), `exempted file ${e.file} does not exist`).not.toThrow()
    }
  })

  it('flags a synthetic mutating handler that lacks both recordAuditEvent and an exemption', () => {
    const syntheticSource = `
      import { createGrant } from '../../core/auth/grants.js'
      export function fakeRouter(): Router {
        const router = Router()
        router.post('/fake/grants', (req, res) => {
          const grant = createGrant(rawDb, { userId: 1, repoId: 'x', role: 'read', grantedBy: 1 })
          res.json(grant)
        })
        return router
      }
    `
    const handlers = extractHandlers('fake.ts', syntheticSource)
    expect(handlers).toHaveLength(1)
    const handler = handlers[0]
    expect(/\bcreateGrant\s*\(/.test(handler.body)).toBe(true)
    expect(/\brecordAuditEvent\s*\(/.test(handler.body)).toBe(false)
    expect(isExempt('fake.ts', handler.method, handler.path, 'repo_grants')).toBe(false)
    // This combination (sensitive write, no audit call, no exemption) is exactly
    // what the main enforcement test above would report as a violation.
  })
})
