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
import { startMcpWebSocketServer } from '../../mcp/webSocketServer.js'
import { startMcpStreamableHttpServer } from '../../mcp/streamableHttpServer.js'
import { getActiveSession } from '../../core/db/sqlite.js'
import { startLspServer, startLspTcpServer, startLspWebSocketServer } from '../../core/lsp/server.js'
import { checkRemoteHealth, type RemoteConfig } from '../../core/remote/protocolClient.js'
import { parseBindAddress } from '../../core/util/websocket.js'
import { serveCommand } from './serve.js'

interface RemoteOpts {
  remote?: string
  remoteKey?: string
  remoteTimeout?: string
}

/** Resolves --remote/--remote-key/--remote-timeout, falling back to GITSEMA_REMOTE/GITSEMA_REMOTE_KEY (same precedence as `index --remote`). */
function resolveRemoteConfig(opts: RemoteOpts): RemoteConfig | undefined {
  const url = opts.remote ?? process.env.GITSEMA_REMOTE
  if (!url) return undefined
  const key = opts.remoteKey ?? process.env.GITSEMA_REMOTE_KEY
  const timeoutMs = opts.remoteTimeout ? parseInt(opts.remoteTimeout, 10) : undefined
  return { url, key, timeoutMs }
}

export function toolsCommand(): Command {
  const cmd = new Command('tools')
    .description(
      'Start long-running protocol servers: MCP (AI tools), LSP (editor integration), HTTP API (remote backend)',
    )

  // ── mcp ──────────────────────────────────────────────────────────────────
  cmd
    .command('mcp')
    .description('Start the gitsema MCP server over stdio (exposes all gitsema capabilities to AI clients)')
    .option('--remote <url>', 'delegate all tool calls to a running `gitsema tools serve` instance (overrides GITSEMA_REMOTE)')
    .option('--remote-key <token>', 'Bearer token for --remote (overrides GITSEMA_REMOTE_KEY)')
    .option('--remote-timeout <ms>', 'timeout in ms for remote calls (default 10000)')
    .option('--websocket <bind-address>', 'listen on WebSocket at /mcp instead of stdio (e.g. --websocket 0.0.0.0:4242); TLS is not terminated here, put a reverse proxy in front for wss://')
    .option('--http <bind-address>', 'listen on the MCP Streamable HTTP transport at /mcp instead of stdio (e.g. --http 0.0.0.0:4242); this is the SDK\'s standard network transport — prefer it over --websocket')
    .option('--key <token>', 'require this Bearer token for --websocket/--http connections')
    .action(async (opts: RemoteOpts & { websocket?: string; http?: string; key?: string }) => {
      if (opts.websocket) {
        console.error(
          'Warning: --websocket is not part of the standard MCP transport set (stdio/SSE/Streamable HTTP); most MCP clients and harnesses do not support raw WebSocket and will fail to connect. Kept for forward compatibility; use stdio (default) unless your client specifically supports WebSocket.',
        )
        let bind: { host: string; port: number }
        try {
          bind = parseBindAddress(opts.websocket)
        } catch (err: unknown) {
          console.error(err instanceof Error ? err.message : String(err))
          process.exit(1)
        }
        startMcpWebSocketServer(bind.host, bind.port, opts.key)
        return
      }
      if (opts.http) {
        let bind: { host: string; port: number }
        try {
          bind = parseBindAddress(opts.http)
        } catch (err: unknown) {
          console.error(err instanceof Error ? err.message : String(err))
          process.exit(1)
        }
        startMcpStreamableHttpServer(bind.host, bind.port, opts.key)
        return
      }
      const remote = resolveRemoteConfig(opts)
      await startMcpServer({ remoteUrl: remote?.url, remoteKey: remote?.key, remoteTimeoutMs: remote?.timeoutMs })
    })

  // ── lsp ──────────────────────────────────────────────────────────────────
  cmd
    .command('lsp')
    .description('Start the LSP-compatible semantic hover server (JSON-RPC over stdio or TCP)')
    .option('--tcp <port>', 'listen on TCP port instead of stdio (e.g. --tcp 2087)')
    .option('--websocket <bind-address>', 'listen on WebSocket at /lsp instead of stdio (e.g. --websocket 0.0.0.0:4242); TLS is not terminated here, put a reverse proxy in front for wss://')
    .option('--key <token>', 'require this Bearer token for --websocket connections')
    .option('--remote <url>', 'delegate all data-access calls to a running `gitsema tools serve` instance (overrides GITSEMA_REMOTE)')
    .option('--remote-key <token>', 'Bearer token for --remote (overrides GITSEMA_REMOTE_KEY)')
    .option('--remote-timeout <ms>', 'timeout in ms for remote calls (default 10000)')
    .option('--diagnostics', 'push textDocument/publishDiagnostics for high-debt/hotspot files on a background timer (opt-in, off by default; not supported with --remote)')
    .action(async (opts: RemoteOpts & { tcp?: string; websocket?: string; key?: string; diagnostics?: boolean }) => {
      const remote = resolveRemoteConfig(opts)
      if (remote) {
        try {
          await checkRemoteHealth(remote)
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error(`Failed to connect to remote at ${remote.url}: ${msg}`)
          process.exit(1)
        }
        if (opts.diagnostics) {
          console.error('Warning: --diagnostics is not supported with --remote; diagnostics will not run.')
        }
      }
      const session = getActiveSession()
      const lspOptions = { diagnostics: opts.diagnostics }
      if (opts.websocket) {
        let bind: { host: string; port: number }
        try {
          bind = parseBindAddress(opts.websocket)
        } catch (err: unknown) {
          console.error(err instanceof Error ? err.message : String(err))
          process.exit(1)
        }
        startLspWebSocketServer(session, bind.host, bind.port, opts.key, remote, lspOptions)
      } else if (opts.tcp) {
        const port = parseInt(opts.tcp, 10)
        if (isNaN(port) || port < 1 || port > 65535) {
          console.error('Error: --tcp requires a valid port number (1–65535)')
          process.exit(1)
        }
        startLspTcpServer(session, port, remote, lspOptions)
      } else {
        startLspServer(session, remote, lspOptions)
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
