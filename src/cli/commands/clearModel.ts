import { getActiveSession } from '../../core/db/sqlite.js'
import { createInterface } from 'node:readline'

export interface ClearModelOptions {
  yes?: boolean
}

/**
 * Deletes all stored embeddings and cache entries for a specific model name.
 * Does not touch blob records or path records — only embedding-layer data.
 */
export async function clearModelCommand(model: string, options: ClearModelOptions = {}): Promise<void> {
  if (!model || model.trim() === '') {
    console.error('Error: model name is required')
    process.exit(1)
  }

  const { rawDb } = getActiveSession()

  // Count what will be deleted
  const embCount = (rawDb.prepare('SELECT COUNT(*) AS c FROM embeddings WHERE model = ?').get(model) as { c: number }).c
  const chunkEmbCount = (rawDb.prepare('SELECT COUNT(*) AS c FROM chunk_embeddings WHERE model = ?').get(model) as { c: number }).c
  const symEmbCount = (rawDb.prepare('SELECT COUNT(*) AS c FROM symbol_embeddings WHERE model = ?').get(model) as { c: number }).c
  const commitEmbCount = (rawDb.prepare('SELECT COUNT(*) AS c FROM commit_embeddings WHERE model = ?').get(model) as { c: number }).c
  const modEmbCount = (rawDb.prepare('SELECT COUNT(*) AS c FROM module_embeddings WHERE model = ?').get(model) as { c: number }).c
  const cacheCount = (rawDb.prepare('SELECT COUNT(*) AS c FROM query_embeddings WHERE model = ?').get(model) as { c: number }).c

  const total = embCount + chunkEmbCount + symEmbCount + commitEmbCount + modEmbCount + cacheCount

  if (total === 0) {
    console.log(`No stored data found for model '${model}'.`)
    return
  }

  console.log(`Will delete data for model '${model}':`)
  if (embCount > 0) console.log(`  ${embCount} blob embedding(s)`)
  if (chunkEmbCount > 0) console.log(`  ${chunkEmbCount} chunk embedding(s)`)
  if (symEmbCount > 0) console.log(`  ${symEmbCount} symbol embedding(s)`)
  if (commitEmbCount > 0) console.log(`  ${commitEmbCount} commit embedding(s)`)
  if (modEmbCount > 0) console.log(`  ${modEmbCount} module embedding(s)`)
  if (cacheCount > 0) console.log(`  ${cacheCount} cached query embedding(s)`)

  if (!options.yes) {
    const confirmed = await promptConfirm(`Proceed? [y/N] `)
    if (!confirmed) {
      console.log('Aborted.')
      return
    }
  }

  rawDb.prepare('DELETE FROM embeddings WHERE model = ?').run(model)
  rawDb.prepare('DELETE FROM chunk_embeddings WHERE model = ?').run(model)
  rawDb.prepare('DELETE FROM symbol_embeddings WHERE model = ?').run(model)
  rawDb.prepare('DELETE FROM commit_embeddings WHERE model = ?').run(model)
  rawDb.prepare('DELETE FROM module_embeddings WHERE model = ?').run(model)
  rawDb.prepare('DELETE FROM query_embeddings WHERE model = ?').run(model)

  console.log(`Cleared all stored data for model '${model}'.`)
}

function promptConfirm(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, (answer: string) => {
      rl.close()
      resolve(answer.trim().toLowerCase() === 'y')
    })
  })
}
