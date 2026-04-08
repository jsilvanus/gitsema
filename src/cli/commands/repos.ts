import { Command } from 'commander'
import { createRequire } from 'node:module'
import { getActiveSession, getRawDb } from '../../core/db/sqlite.js'
import { addRepo, listRepos, multiRepoSearch } from '../../core/indexing/repoRegistry.js'
import { buildProvider } from '../../core/embedding/providerFactory.js'
import { embedQuery } from '../../core/embedding/embedQuery.js'
import { parsePositiveInt } from '../../utils/parse.js'

const require = createRequire(import.meta.url)

export function reposCommand(): Command {
  const cmd = new Command('repos')
    .description('Manage tracked repositories for multi-repo indexing')

  cmd
    .command('add <id> <name> [url]')
    .description('Add a repository to the local registry')
    .option('--db-path <path>', 'path to the .gitsema/index.db of the remote repo')
    .action((id: string, name: string, url?: string, opts?: { dbPath?: string }) => {
      const session = getActiveSession()
      addRepo(session, id, name, url, opts?.dbPath)
      console.log(`Added repo ${id} (${name})${opts?.dbPath ? ` db: ${opts.dbPath}` : ''}`)
    })

  cmd
    .command('list')
    .description('List all tracked repositories')
    .option('--no-headings', "don't print column header row")
    .action((opts: { noHeadings?: boolean }) => {
      const session = getActiveSession()
      const repos = listRepos(session)
      if (repos.length === 0) {
        console.log('No repositories registered. Use: gitsema repos add <id> <name> [url]')
        return
      }
      if (!opts.noHeadings) {
        console.log(`${'ID'.padEnd(16)}\t${'Name'.padEnd(20)}\t${'URL'.padEnd(30)}\t${'DB_Path'.padEnd(20)}\tAdded`)
      }
      for (const r of repos) {
        const added = new Date(r.addedAt * 1000).toISOString().slice(0, 10)
        console.log(`${r.id}\t${r.name}\t${r.url ?? '(no url)'}\t${r.dbPath ?? '(no db-path)'}\t${added}`)
      }
    })

  cmd
    .command('search <query>')
    .description('Search across multiple registered repos (requires --db-path on each repo)')
    .option('--repos <ids>', 'comma-separated repo IDs to search (default: all)')
    .option('--top <n>', 'number of results (default 10)', '10')
    .option('--model <model>', 'embedding model override')
    .option('--no-headings', "don't print column header row")
    .action(async (query: string, opts: { repos?: string; top?: string; model?: string; noHeadings?: boolean }) => {
      let topK: number
      try {
        topK = parsePositiveInt(opts.top ?? '10', '--top')
      } catch (e) {
        console.error(String(e))
        process.exit(1)
      }
      const session = getActiveSession()
      const repoIds = opts.repos ? opts.repos.split(',').map((s) => s.trim()) : undefined
      const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
      const model = opts.model ?? process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
      const provider = buildProvider(providerType, model)
      let embedding: number[]
      try {
        embedding = await embedQuery(provider, query) as number[]
      } catch (e) {
        console.error(`Error embedding query: ${e instanceof Error ? e.message : String(e)}`)
        process.exit(1)
        throw e
      }
      const results = await multiRepoSearch(session, embedding, { repoIds, topK, model })
      if (results.length === 0) {
        console.log('No results. Ensure repos have --db-path set and are indexed.')
        return
      }
      if (!opts.noHeadings) {
        console.log(`${'Repo'.padEnd(16)}  ${'Score'.padEnd(6)}  Path`)
      }
      for (const r of results) {
        const path = r.paths?.[0] ?? r.blobHash.slice(0, 8)
        console.log(`[${r.repoId}] ${r.score.toFixed(3)}  ${path}`)
      }
    })

  // ── token subcommands for per-repo access control (Phase 75) ─────────────

  const tokenCmd = new Command('token').description('Manage per-repo scoped access tokens')

  tokenCmd
    .command('add <repo-id> [label]')
    .description('Mint a new scoped access token for the given repo ID')
    .action((repoId: string, label?: string) => {
      const rawDb = getRawDb()
      // Verify repo exists
      const repo = rawDb.prepare('SELECT id FROM repos WHERE id = ?').get(repoId)
      if (!repo) {
        console.error(`Error: repo '${repoId}' not found. Use: gitsema repos add`)
        process.exit(1)
      }
      const { randomBytes } = require('node:crypto') as typeof import('node:crypto')
      const token = randomBytes(32).toString('hex')
      rawDb.prepare('INSERT INTO repo_tokens (token, repo_id, label, created_at) VALUES (?, ?, ?, ?)')
        .run(token, repoId, label ?? null, Math.floor(Date.now() / 1000))
      console.log(`Token minted for repo '${repoId}':`)
      console.log(`  ${token}`)
      if (label) console.log(`  Label: ${label}`)
      console.log(`\nAdd Authorization: Bearer ${token} to HTTP requests to scope them to repo '${repoId}'.`)
    })

  tokenCmd
    .command('list')
    .description('List all scoped tokens')
    .action(() => {
      const rawDb = getRawDb()
      const rows = rawDb.prepare('SELECT token, repo_id, label, created_at FROM repo_tokens ORDER BY created_at ASC')
        .all() as Array<{ token: string; repo_id: string; label: string | null; created_at: number }>
      if (rows.length === 0) {
        console.log('No scoped tokens minted. Use: gitsema repos token add <repo-id>')
        return
      }
      console.log(`${'Token (prefix)'.padEnd(16)}  ${'Repo ID'.padEnd(20)}  ${'Label'.padEnd(20)}  Created`)
      for (const r of rows) {
        const prefix = r.token.slice(0, 12) + '...'
        const created = new Date(r.created_at * 1000).toISOString().slice(0, 10)
        console.log(`${prefix.padEnd(16)}  ${r.repo_id.padEnd(20)}  ${(r.label ?? '-').padEnd(20)}  ${created}`)
      }
    })

  tokenCmd
    .command('revoke <token-prefix>')
    .description('Revoke a scoped token by its prefix (at least 8 hex chars)')
    .action((prefix: string) => {
      if (prefix.length < 8) {
        console.error('Error: token prefix must be at least 8 characters for safety')
        process.exit(1)
      }
      const rawDb = getRawDb()
      const rows = rawDb.prepare('SELECT token FROM repo_tokens WHERE token LIKE ?')
        .all(prefix + '%') as Array<{ token: string }>
      if (rows.length === 0) {
        console.log(`No token found with prefix '${prefix}'.`)
        return
      }
      if (rows.length > 1) {
        console.error(`Ambiguous prefix — ${rows.length} tokens match. Use a longer prefix.`)
        process.exit(1)
      }
      rawDb.prepare('DELETE FROM repo_tokens WHERE token = ?').run(rows[0].token)
      console.log(`Token revoked: ${rows[0].token.slice(0, 12)}...`)
    })

  cmd.addCommand(tokenCmd)

  return cmd
}
