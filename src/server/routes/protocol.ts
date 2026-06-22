/**
 * Generic protocol-delegation route (Phase 113 — LSP & MCP fleshout, Phase A).
 *
 * `POST /api/v1/protocol/:operation` is the single endpoint both `tools lsp
 * --remote` and `tools mcp --remote` call through `protocolClient.ts`. It
 * does not duplicate any tool/handler logic:
 *
 * - `mcp.<toolName>` operations are dispatched by capturing the same
 *   `registerXxxTools(server)` calls the real MCP server uses, against a
 *   fake `server.tool()` that records each tool's final wrapped handler
 *   (already including embed helpers + error formatting) into a map.
 * - `lsp.<op>` operations are dispatched straight through the existing
 *   `handleRequest()` JSON-RPC dispatcher in `core/lsp/server.ts`.
 */

import { Router } from 'express'
import { handleRequest as handleLspRequest, type JsonRpcRequest } from '../../core/lsp/server.js'
import { getActiveSession } from '../../core/db/sqlite.js'
import { registerSearchTools } from '../../mcp/tools/search.js'
import { registerAnalysisTools } from '../../mcp/tools/analysis.js'
import { registerClusteringTools } from '../../mcp/tools/clustering.js'
import { registerWorkflowTools } from '../../mcp/tools/workflow.js'
import { registerInfrastructureTools } from '../../mcp/tools/infrastructure.js'
import { registerNarratorTools } from '../../mcp/tools/narrator.js'
import { registerGraphTools } from '../../mcp/tools/graph.js'

type McpHandlerFn = (args: unknown) => Promise<unknown>

let _mcpDispatch: Map<string, McpHandlerFn> | null = null

function getMcpDispatch(): Map<string, McpHandlerFn> {
  if (_mcpDispatch) return _mcpDispatch
  const map = new Map<string, McpHandlerFn>()
  const fakeServer = {
    tool: (name: string, _description: string, _schema: unknown, fn: McpHandlerFn) => {
      map.set(name, fn)
    },
  }
  registerSearchTools(fakeServer as any)
  registerAnalysisTools(fakeServer as any)
  registerClusteringTools(fakeServer as any)
  registerWorkflowTools(fakeServer as any)
  registerInfrastructureTools(fakeServer as any)
  registerNarratorTools(fakeServer as any)
  registerGraphTools(fakeServer as any)
  _mcpDispatch = map
  return map
}

/** Maps `lsp.<op>` names to the JSON-RPC method `handleRequest()` expects. */
const LSP_OP_TO_METHOD: Record<string, string> = {
  hover: 'textDocument/hover',
  definition: 'textDocument/definition',
  references: 'textDocument/references',
  documentSymbol: 'textDocument/documentSymbol',
  workspaceSymbol: 'workspace/symbol',
  prepareCallHierarchy: 'textDocument/prepareCallHierarchy',
  incomingCalls: 'callHierarchy/incomingCalls',
  outgoingCalls: 'callHierarchy/outgoingCalls',
  codeLens: 'textDocument/codeLens',
}

export function protocolRouter(): Router {
  const router = Router()

  router.post('/:operation', async (req, res) => {
    const operation = req.params.operation
    const args =
      req.body && typeof req.body === 'object' && 'args' in (req.body as Record<string, unknown>)
        ? (req.body as Record<string, unknown>).args
        : undefined

    try {
      if (operation.startsWith('mcp.')) {
        const toolName = operation.slice('mcp.'.length)
        const fn = getMcpDispatch().get(toolName)
        if (!fn) {
          res.status(404).json({ error: `Unknown MCP operation: ${operation}` })
          return
        }
        const result = await fn(args)
        res.json({ result })
        return
      }

      if (operation.startsWith('lsp.')) {
        const lspOp = operation.slice('lsp.'.length)
        const method = LSP_OP_TO_METHOD[lspOp]
        if (!method) {
          res.status(404).json({ error: `Unknown LSP operation: ${operation}` })
          return
        }
        const session = getActiveSession()
        const rpcReq: JsonRpcRequest = { jsonrpc: '2.0', id: 1, method, params: args }
        const rpcRes = await handleLspRequest(session, rpcReq)
        if (rpcRes?.error) {
          res.status(500).json({ error: rpcRes.error.message ?? String(rpcRes.error) })
          return
        }
        res.json({ result: rpcRes?.result ?? null })
        return
      }

      res.status(404).json({ error: `Unknown operation: ${operation}` })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: msg })
    }
  })

  return router
}
