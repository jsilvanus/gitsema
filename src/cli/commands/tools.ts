/**
 * `gitsema tools` — subcommand group for long-running protocol servers.
 *
 * Subcommands:
 *   gitsema tools mcp    — Start the MCP stdio server (AI tool interface)
 *   gitsema tools lsp    — Start the LSP JSON-RPC server (editor integration)
 *   gitsema tools serve  — Start the HTTP API server (remote embedding backend)
 *
 * The legacy top-level aliases `gitsema mcp`, `gitsema lsp`, and `gitsema serve`
 * remain registered as hidden commands for backward compatibility.
 */

import { Command } from 'commander'
import { startMcpServer } from '../../mcp/server.js'
import { getActiveSession } from '../../core/db/sqlite.js'
import { startLspServer, startLspTcpServer } from '../../core/lsp/server.js'
import { serveCommand } from './serve.js'

export function toolsCommand(): Command {
  const cmd = new Command('tools')
    .description(
      'Start long-running protocol servers: MCP (AI tools), LSP (editor integration), HTTP API (remote backend)',
    )

  // ── mcp ──────────────────────────────────────────────────────────────────
  cmd
    .command('mcp')
    .description('Start the gitsema MCP server over stdio (exposes all gitsema capabilities to AI clients)')
    .action(async () => {
      await startMcpServer()
    })

  // ── lsp ──────────────────────────────────────────────────────────────────
  cmd
    .command('lsp')
    .description('Start the LSP-compatible semantic hover server (JSON-RPC over stdio or TCP)')
    .option('--tcp <port>', 'listen on TCP port instead of stdio (e.g. --tcp 2087)')
    .action((opts: { tcp?: string }) => {
      const session = getActiveSession()
      if (opts.tcp) {
        const port = parseInt(opts.tcp, 10)
        if (isNaN(port) || port < 1 || port > 65535) {
          console.error('Error: --tcp requires a valid port number (1–65535)')
          process.exit(1)
        }
        startLspTcpServer(session, port)
      } else {
        startLspServer(session)
      }
    })

  // ── serve ─────────────────────────────────────────────────────────────────
  cmd
    .command('serve')
    .description('Start the gitsema HTTP API server (embedding and storage backend)')
    .option('--port <n>', 'port to listen on (default 4242, overrides GITSEMA_SERVE_PORT)')
    .option('--key <token>', 'require this Bearer token for all requests (overrides GITSEMA_SERVE_KEY)')
    .option(
      '--chunker <strategy>',
      'chunking strategy for incoming blobs: file (default), function, fixed',
    )
    .option('--concurrency <n>', 'max concurrent embedding calls (default 4)')
    .option(
      '--ui',
      'serve the embedding space explorer web UI at /ui (requires prior `gitsema project` run)',
    )
    .action(serveCommand)

  return cmd
}
