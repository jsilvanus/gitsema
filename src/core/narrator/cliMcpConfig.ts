/**
 * MCP config generation for CLI-based guide providers.
 *
 * When a guide model config has `provider: 'cli'` and `params.useMcp`, the
 * CLI tool is launched with `--mcp-config <path>` pointing at gitsema's own
 * MCP server (`gitsema tools mcp`), so the CLI tool's own agent loop can call
 * gitsema's analysis tools directly against the current repo's
 * `.gitsema/index.db`.
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * Write a temporary MCP config file exposing gitsema's `tools mcp` server,
 * scoped to `repoRoot`. Returns the path to the written config file.
 *
 * Re-uses the currently running gitsema entrypoint (`process.argv[1]`) so
 * the spawned CLI tool talks to the same build / `.gitsema/index.db`.
 */
export function writeGitsemaMcpConfig(repoRoot: string): string {
  const config = {
    mcpServers: {
      gitsema: {
        command: process.execPath,
        args: [process.argv[1], 'tools', 'mcp'],
        cwd: repoRoot,
      },
    },
  }

  const dir = mkdtempSync(join(tmpdir(), 'gitsema-mcp-'))
  const configPath = join(dir, 'mcp-config.json')
  writeFileSync(configPath, JSON.stringify(config, null, 2))
  return configPath
}
