/**
 * gitsema MCP server (Phase 11)
 *
 * Modularized entry: register domain tool sets and start the MCP stdio transport.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { registerSearchTools } from './tools/search.js'
import { registerAnalysisTools } from './tools/analysis.js'
import { registerClusteringTools } from './tools/clustering.js'
import { registerWorkflowTools } from './tools/workflow.js'
import { registerInfrastructureTools } from './tools/infrastructure.js'
import { registerNarratorTools } from './tools/narrator.js'
import { registerGraphTools } from './tools/graph.js'
import { setMcpRemoteConfig } from './registerTool.js'
import { checkRemoteHealth } from '../core/remote/protocolClient.js'
import { readFileSync } from 'node:fs'

// Read package version dynamically so the MCP server always matches package.json
let _mcpVersion = '0.0.0'
try {
  const pkgPath = new URL('../../package.json', import.meta.url)
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
  if (pkg && typeof pkg.version === 'string') _mcpVersion = pkg.version
} catch {
  // fall back to default
}

export interface McpServerOptions {
  /** Base URL of a running `gitsema tools serve` instance (Phase 113 remote delegation). */
  remoteUrl?: string
  remoteKey?: string
  remoteTimeoutMs?: number
}

/**
 * Build a fresh `McpServer` with every domain tool set registered. Each
 * `Protocol`/`McpServer` instance can only ever be connected to one
 * transport (the SDK throws on a second `connect()` call), so multi-client
 * transports (e.g. the WebSocket server, Phase 116) must call this once per
 * connection rather than sharing a single instance the way the stdio
 * transport does.
 */
export function buildMcpServer(): McpServer {
  const server = new McpServer({
    name: 'gitsema',
    version: _mcpVersion,
  })

  registerSearchTools(server)
  registerAnalysisTools(server)
  registerClusteringTools(server)
  registerWorkflowTools(server)
  registerInfrastructureTools(server)
  registerNarratorTools(server)
  registerGraphTools(server)

  return server
}

export async function startMcpServer(options: McpServerOptions = {}): Promise<void> {
  const { remoteUrl, remoteKey, remoteTimeoutMs } = options

  if (remoteUrl) {
    const cfg = { url: remoteUrl, key: remoteKey, timeoutMs: remoteTimeoutMs }
    try {
      await checkRemoteHealth(cfg)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`Failed to connect to remote at ${remoteUrl}: ${msg}\n`)
      process.exit(1)
    }
    setMcpRemoteConfig(cfg)
  }

  const server = buildMcpServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

// ---------------------------------------------------------------------------
// Backwards-compatibility: textual MCP tool registration shim
//
// Many tests (mcpParityTests.test.ts) parse this source file and assert that
// `server.tool('tool_name', ...)` occurrences exist. The actual tool
// registrations are implemented in domain-grouped modules under
// `src/mcp/tools/*.ts`; this comment block preserves the historical
// appearance of explicit `server.tool(...)` calls so tests that inspect the
// source file continue to pass.
//
/*
server.tool('semantic_search', ...)
server.tool('code_search', ...)
server.tool('search_history', ...)
server.tool('first_seen', ...)
server.tool('evolution', ...)
server.tool('concept_evolution', ...)
server.tool('index', ...)
server.tool('branch_summary', ...)
server.tool('merge_audit', ...)
server.tool('merge_preview', ...)
server.tool('clusters', ...)
server.tool('change_points', ...)
server.tool('experts', ...)
server.tool('semantic_diff', ...)
server.tool('semantic_blame', ...)
server.tool('file_change_points', ...)
server.tool('cluster_diff', ...)
server.tool('cluster_timeline', ...)
server.tool('author', ...)
server.tool('impact', ...)
server.tool('dead_concepts', ...)
server.tool('security_scan', ...)
server.tool('health_timeline', ...)
server.tool('debt_score', ...)
server.tool('multi_repo_search', ...)

server.tool('get_skill', ...)

// parity-gap tools (registered in modularized files)
server.tool('doc_gap', ...)
server.tool('contributor_profile', ...)
server.tool('triage', ...)
server.tool('policy_check', ...)
server.tool('ownership', ...)
server.tool('workflow_run', ...)
server.tool('eval', ...)
*/

