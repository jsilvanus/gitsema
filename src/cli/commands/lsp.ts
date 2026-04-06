import { Command } from 'commander'
import { getActiveSession } from '../../core/db/sqlite.js'
import { startLspServer, startLspTcpServer } from '../../core/lsp/server.js'

export function lspCommand(): Command {
  return new Command('lsp')
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
}
