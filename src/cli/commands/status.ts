import { db, DB_PATH } from '../../core/db/sqlite.js'
import { blobs, embeddings, paths } from '../../core/db/schema.js'
import { walk } from '../../core/git/walker.js'
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

  console.log(`gitsema v0.0.1`)
  console.log(`DB:                ${DB_PATH}`)
  console.log(`Blobs indexed:     ${blobCount.count}`)
  console.log(`Embeddings stored: ${embeddingCount.count}`)
  console.log(`Path entries:      ${pathCount.count}`)
  console.log('')
  console.log('Scanning repo blobs...')

  const stats = await walk({ repoPath: '.' })

  console.log(`Repo unique blobs: ${stats.seen}`)
  console.log(`Blobs skipped:     ${stats.skipped} (over size limit)`)
  console.log(`Total blob data:   ${formatBytes(stats.totalBytes)}`)
}
