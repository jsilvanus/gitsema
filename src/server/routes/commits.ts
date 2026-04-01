import { Router } from 'express'
import { z } from 'zod'
import { storeCommitWithBlobs, markCommitIndexed } from '../../core/indexing/blobStore.js'

const CommitPayloadSchema = z.object({
  commitHash: z.string(),
  timestamp: z.number().int(),
  message: z.string(),
  blobHashes: z.array(z.string()),
})

const CommitsBodySchema = z.array(CommitPayloadSchema).min(1).max(500)

const MarkIndexedSchema = z.object({
  commitHash: z.string(),
})

export function commitsRouter(): Router {
  const router = Router()

  // POST /commits — store commit metadata and blob-commit links
  router.post('/', (req, res) => {
    const parsed = CommitsBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }

    let stored = 0
    for (const commit of parsed.data) {
      storeCommitWithBlobs(
        { commitHash: commit.commitHash, timestamp: commit.timestamp, message: commit.message },
        commit.blobHashes,
      )
      stored++
    }

    res.json({ stored })
  })

  // POST /commits/mark-indexed — record a commit as fully processed for incremental indexing
  router.post('/mark-indexed', (req, res) => {
    const parsed = MarkIndexedSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    markCommitIndexed(parsed.data.commitHash)
    res.json({ ok: true })
  })

  return router
}
