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

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: 'gitsema',
    version: '0.0.1',
  })

  // Register domain-grouped tool sets
  registerSearchTools(server)
  registerAnalysisTools(server)
  registerClusteringTools(server)
  registerWorkflowTools(server)
  registerInfrastructureTools(server)

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

