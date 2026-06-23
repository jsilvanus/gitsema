import { Command } from 'commander'
import { createHash, randomBytes } from 'node:crypto'
import { rmSync } from 'node:fs'
import { getActiveSession, getRawDb } from '../../core/db/sqlite.js'
import { addRepo, listRepos, multiRepoSearch, getRegistrySession, getRepo, getRepoDir, removeRepo, setRepoVisibility } from '../../core/indexing/repoRegistry.js'
import { buildProvider } from '../../core/embedding/providerFactory.js'
import { embedQuery } from '../../core/embedding/embedQuery.js'
import { parsePositiveInt } from '../../utils/parse.js'
import { getUserByUsername } from '../../core/auth/identity.js'
import { getOrgByName } from '../../core/auth/orgs.js'
import { createGrant, revokeGrant, listGrants, moveRepoToOrg } from '../../core/auth/grants.js'

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

  cmd
    .command('list-persisted')
    .description('List repos persisted under GITSEMA_DATA_DIR (server-side registry)')
    .option('--no-headings', "don't print column header row")
    .action((opts: { noHeadings?: boolean }) => {
      const session = getRegistrySession()
      const repos = listRepos(session).filter((r) => r.clonePath || r.dbPath)
      if (repos.length === 0) {
        console.log('No persisted repos. They are registered automatically by `gitsema tools serve` on first remote index.')
        return
      }
      if (!opts.noHeadings) {
        console.log(`${'ID'.padEnd(18)}\t${'URL'.padEnd(40)}\t${'Last Indexed'.padEnd(20)}\tClone Path`)
      }
      for (const r of repos) {
        const lastIndexed = r.lastIndexedAt ? new Date(r.lastIndexedAt * 1000).toISOString() : '(never)'
        console.log(`${r.id}\t${r.url ?? '(no url)'}\t${lastIndexed}\t${r.clonePath ?? '(no path)'}`)
      }
    })

  cmd
    .command('remove <repoId>')
    .description('Remove a persisted repo from the server-side registry')
    .option('--purge', 'also delete the on-disk clone + index directory')
    .action((repoId: string, opts: { purge?: boolean }) => {
      const session = getRegistrySession()
      const repo = getRepo(session, repoId)
      if (!repo) {
        console.error(`Error: repo '${repoId}' not found in registry`)
        process.exit(1)
      }
      removeRepo(session, repoId)
      console.log(`Removed repo ${repoId} from registry`)
      if (opts.purge) {
        const dir = getRepoDir(repoId)
        rmSync(dir, { recursive: true, force: true })
        console.log(`Purged on-disk data at ${dir}`)
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
      const token = randomBytes(32).toString('hex')
      // Store SHA-256 hash + first-8-char prefix; never store plaintext (review7 §4.1).
      const tokenHash = createHash('sha256').update(token).digest('hex')
      const tokenPrefix = token.slice(0, 8)
      rawDb.prepare('INSERT INTO repo_tokens (token_hash, token_prefix, repo_id, label, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(tokenHash, tokenPrefix, repoId, label ?? null, Math.floor(Date.now() / 1000))
      console.log(`Token minted for repo '${repoId}':`)
      console.log(`  ${token}`)
      if (label) console.log(`  Label: ${label}`)
      console.log(`\nCopy this token now — it cannot be recovered. Use it as:`)
      console.log(`  Authorization: Bearer ${token}`)
    })

  tokenCmd
    .command('list')
    .description('List all scoped tokens')
    .action(() => {
      const rawDb = getRawDb()
      const rows = rawDb.prepare('SELECT token_prefix, repo_id, label, created_at FROM repo_tokens ORDER BY created_at ASC')
        .all() as Array<{ token_prefix: string; repo_id: string; label: string | null; created_at: number }>
      if (rows.length === 0) {
        console.log('No scoped tokens minted. Use: gitsema repos token add <repo-id>')
        return
      }
      console.log(`${'Token (prefix)'.padEnd(16)}  ${'Repo ID'.padEnd(20)}  ${'Label'.padEnd(20)}  Created`)
      for (const r of rows) {
        const prefix = r.token_prefix + '...'
        const created = new Date(r.created_at * 1000).toISOString().slice(0, 10)
        console.log(`${prefix.padEnd(16)}  ${r.repo_id.padEnd(20)}  ${(r.label ?? '-').padEnd(20)}  ${created}`)
      }
    })

  tokenCmd
    .command('revoke <token-prefix>')
    .description('Revoke a scoped token by its 8-char prefix (shown during token add)')
    .action((prefix: string) => {
      if (prefix.length < 8) {
        console.error('Error: token prefix must be at least 8 characters for safety')
        process.exit(1)
      }
      const rawDb = getRawDb()
      const rows = rawDb.prepare('SELECT token_prefix FROM repo_tokens WHERE token_prefix LIKE ?')
        .all(prefix + '%') as Array<{ token_prefix: string }>
      if (rows.length === 0) {
        console.log(`No token found with prefix '${prefix}'.`)
        return
      }
      if (rows.length > 1) {
        console.error(`Ambiguous prefix — ${rows.length} tokens match. Use a longer prefix.`)
        process.exit(1)
      }
      rawDb.prepare('DELETE FROM repo_tokens WHERE token_prefix = ?').run(rows[0].token_prefix)
      console.log(`Token revoked: ${rows[0].token_prefix}...`)
    })

  cmd.addCommand(tokenCmd)

  // ── grant subcommands for repo/branch access control (Phase 123) ─────────

  cmd
    .command('grant <repo-id> <username>')
    .description('Grant a user a role on a repo, optionally scoped to a branch pattern (Phase 123)')
    .requiredOption('--role <role>', 'read | write | owner')
    .option('--branch <pattern>', 'glob pattern restricting the grant to matching branches (default: all branches)')
    .option('--granted-by <username>', 'username to record as the granting user (defaults to the target user themself if omitted)')
    .action((repoId: string, username: string, opts: { role: string; branch?: string; grantedBy?: string }) => {
      if (!['read', 'write', 'owner'].includes(opts.role)) {
        console.error("Error: --role must be 'read', 'write', or 'owner'")
        process.exit(1)
      }
      const rawDb = getRawDb()
      const repo = rawDb.prepare('SELECT id FROM repos WHERE id = ?').get(repoId)
      if (!repo) {
        console.error(`Error: repo '${repoId}' not found. Use: gitsema repos add`)
        process.exit(1)
      }
      const target = getUserByUsername(rawDb, username)
      if (!target) {
        console.error(`Error: user '${username}' not found`)
        process.exit(1)
      }
      const granter = opts.grantedBy ? getUserByUsername(rawDb, opts.grantedBy) : target
      if (!granter) {
        console.error(`Error: user '${opts.grantedBy}' not found`)
        process.exit(1)
      }
      const grant = createGrant(rawDb, {
        userId: target.id,
        repoId,
        role: opts.role as 'read' | 'write' | 'owner',
        branchPattern: opts.branch ?? null,
        grantedBy: granter.id,
      })
      console.log(`Granted '${username}' ${grant.role} on repo '${repoId}'${grant.branchPattern ? ` (branch: ${grant.branchPattern})` : ''}.`)
    })

  cmd
    .command('grants <repo-id>')
    .description('List grants on a repo (Phase 123)')
    .action((repoId: string) => {
      const grants = listGrants(getRawDb(), repoId)
      if (grants.length === 0) {
        console.log(`No grants on repo '${repoId}'. Use: gitsema repos grant <repo-id> <username> --role <role>`)
        return
      }
      console.log(`${'User ID'.padEnd(10)}  ${'Role'.padEnd(8)}  Branch`)
      for (const g of grants) console.log(`${String(g.userId).padEnd(10)}  ${g.role.padEnd(8)}  ${g.branchPattern ?? '(all)'}`)
    })

  cmd
    .command('revoke <repo-id> <username>')
    .description('Revoke all of a user\'s grants on a repo (Phase 123)')
    .action((repoId: string, username: string) => {
      const target = getUserByUsername(getRawDb(), username)
      if (!target) {
        console.error(`Error: user '${username}' not found`)
        process.exit(1)
      }
      const revoked = revokeGrant(getRawDb(), target.id, repoId)
      console.log(`Revoked ${revoked} grant(s) for '${username}' on repo '${repoId}'.`)
    })

  cmd
    .command('visibility <repo-id> <state>')
    .description('Set a repo\'s visibility to public or private (Phase 126) — operator-only, no network auth boundary')
    .action((repoId: string, state: string) => {
      if (state !== 'public' && state !== 'private') {
        console.error("Error: state must be 'public' or 'private'")
        process.exit(1)
      }
      const session = getRegistrySession()
      const repo = getRepo(session, repoId)
      if (!repo) {
        console.error(`Error: repo '${repoId}' not found in registry`)
        process.exit(1)
      }
      setRepoVisibility(session, repoId, state)
      console.log(`Repo '${repoId}' visibility set to '${state}'.`)
    })

  cmd
    .command('move-to-org <repo-id> <org>')
    .description('Move a repo to a different org; existing grants survive the move (Phase 123)')
    .action((repoId: string, orgName: string) => {
      const rawDb = getRawDb()
      const repo = rawDb.prepare('SELECT id FROM repos WHERE id = ?').get(repoId)
      if (!repo) {
        console.error(`Error: repo '${repoId}' not found. Use: gitsema repos add`)
        process.exit(1)
      }
      const org = getOrgByName(rawDb, orgName)
      if (!org) {
        console.error(`Error: org '${orgName}' not found`)
        process.exit(1)
      }
      moveRepoToOrg(rawDb, repoId, org.id)
      console.log(`Moved repo '${repoId}' to org '${orgName}'.`)
    })

  return cmd
}
