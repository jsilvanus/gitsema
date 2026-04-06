import { Command } from 'commander'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getActiveSession } from '../../core/db/sqlite.js'
import { buildProvider } from '../../core/embedding/providerFactory.js'
import { scoreDebt } from '../../core/search/debtScoring.js'

export function debtCommand(): Command {
  return new Command('debt')
    .description('Score technical debt across the codebase')
    .option('--top <n>', 'top results', '20')
    .option('--model <model>', 'embedding model')
    .option('--branch <name>', 'restrict to blobs on this branch')
    .option('--dump [file]', 'output JSON to file or stdout')
    .action(async (opts: { top?: string; model?: string; branch?: string; dump?: string | boolean }) => {
      const session = getActiveSession()
      const top = parseInt(opts.top ?? '20', 10)
      const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
      const model = opts.model ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
      const provider = buildProvider(providerType, model)

      // Warn if no HNSW index is present — isolation scores will use an O(N²)
      // cosine scan which is slow for large repos. Recommend building the index first.
      const safeName = model.replace(/[^a-zA-Z0-9._-]/g, '_')
      const indexPath = join('.gitsema', `vectors-${safeName}.usearch`)
      if (!existsSync(indexPath)) {
        console.warn(
          'Warning: No HNSW vector index found. Isolation scores will use an O(N²) cosine scan\n' +
          '  which can be very slow for repos with >10K blobs.\n' +
          '  Run `gitsema build-vss` first to build the HNSW index for fast isolation scoring.',
        )
      }

      const results = await scoreDebt(session, provider, { top, model, branch: opts.branch })
      if (opts.dump !== undefined) {
        const json = JSON.stringify(results, null, 2)
        if (typeof opts.dump === 'string') {
          writeFileSync(opts.dump, json, 'utf8')
          console.log(`Debt results written to: ${opts.dump}`)
        } else {
          process.stdout.write(json + '\n')
        }
        return
      }
      for (const r of results) {
        console.log(`${r.blobHash.slice(0, 8)}\t${r.debtScore.toFixed(3)}\t${r.paths.join(',')}`)
      }
    })
}
