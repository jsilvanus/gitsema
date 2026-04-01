import { Router } from 'express'
import { db, DB_PATH } from '../../core/db/sqlite.js'
import { blobs, embeddings, chunks, commits } from '../../core/db/schema.js'
import { sql } from 'drizzle-orm'

export function statusRouter(): Router {
  const router = Router()

  router.get('/', (_req, res) => {
    const [blobCount] = db.select({ count: sql<number>`count(*)` }).from(blobs).all()
    const [embCount] = db.select({ count: sql<number>`count(*)` }).from(embeddings).all()
    const [chunkCount] = db.select({ count: sql<number>`count(*)` }).from(chunks).all()
    const [commitCount] = db.select({ count: sql<number>`count(*)` }).from(commits).all()

    const model = process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
    const codeModel = process.env.GITSEMA_CODE_MODEL ?? model

    res.json({
      blobs: blobCount.count,
      embeddings: embCount.count,
      chunks: chunkCount.count,
      commits: commitCount.count,
      dbPath: DB_PATH,
      model,
      codeModel: codeModel !== model ? codeModel : undefined,
    })
  })

  return router
}
