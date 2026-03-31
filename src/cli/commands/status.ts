import { db, DB_PATH } from '../../core/db/sqlite.js'
import { blobs, embeddings, paths } from '../../core/db/schema.js'
import { walk } from '../../core/git/walker.js'
import { OllamaProvider } from '../../core/embedding/local.js'
import { sql } from 'drizzle-orm'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export async function statusCommand(): Promise<void> {
  const [blobCount] = db.select({ count: sql<number>`count(*)` }).from(blobs).all()
  const [embeddingCount] = db.select({ count: sql<number>`count(*)` }).from(embeddings).all()
  const [pathCount] = db.select({ count: sql<number>`count(*)` }).from(paths).all()

  // Resolve provider config from env or defaults
  const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
  const model = process.env.GITSEMA_MODEL ?? 'nomic-embed-text'

  console.log(`gitsema v0.0.1`)
  console.log(`DB:                ${DB_PATH}`)
  console.log(`Provider:          ${providerType}`)
  console.log(`Model:             ${model}`)
  console.log(`Blobs indexed:     ${blobCount.count}`)
  console.log(`Embeddings stored: ${embeddingCount.count}`)
  console.log(`Path entries:      ${pathCount.count}`)

  // Check if provider is reachable
  if (providerType === 'ollama') {
    const provider = new OllamaProvider({ model })
    try {
      await provider.embed('ping')
      console.log(`Provider status:   reachable (dimensions: ${provider.dimensions})`)
    } catch {
      console.log(`Provider status:   unreachable (is Ollama running?)`)
    }
  }

  console.log('')
  console.log('Scanning repo blobs...')

  const stats = await walk({ repoPath: '.' })

  console.log(`Repo unique blobs: ${stats.seen}`)
  console.log(`Blobs skipped:     ${stats.skipped} (over size limit)`)
  console.log(`Total blob data:   ${formatBytes(stats.totalBytes)}`)
}
