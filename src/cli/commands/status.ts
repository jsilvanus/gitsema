import { db, DB_PATH } from '../../core/db/sqlite.js'
import { blobs, embeddings, paths } from '../../core/db/schema.js'
import { sql } from 'drizzle-orm'

export async function statusCommand(): Promise<void> {
  const [blobCount] = db.select({ count: sql<number>`count(*)` }).from(blobs).all()
  const [embeddingCount] = db.select({ count: sql<number>`count(*)` }).from(embeddings).all()
  const [pathCount] = db.select({ count: sql<number>`count(*)` }).from(paths).all()

  console.log(`gitsema v0.0.1`)
  console.log(`DB: ${DB_PATH}`)
  console.log(`Blobs indexed:    ${blobCount.count}`)
  console.log(`Embeddings stored: ${embeddingCount.count}`)
  console.log(`Path entries:      ${pathCount.count}`)
}
