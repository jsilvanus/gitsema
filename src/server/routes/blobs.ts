import { Router } from 'express'
import { z } from 'zod'
import type { EmbeddingProvider } from '../../core/embedding/provider.js'
import { RoutingProvider } from '../../core/embedding/router.js'
import type { ChunkStrategy } from '../../core/chunking/chunker.js'
import { createChunker } from '../../core/chunking/chunker.js'
import { filterNewBlobs } from '../../core/indexing/deduper.js'
import { storeBlob, storeBlobRecord, storeChunk } from '../../core/indexing/blobStore.js'
import { logger } from '../../utils/logger.js'
import { createLimiter } from '../../utils/concurrency.js'

const CheckBodySchema = z.object({
  hashes: z.array(z.string()).min(1).max(500),
})

const BlobPayloadSchema = z.object({
  blobHash: z.string(),
  path: z.string(),
  size: z.number().int().nonnegative(),
  content: z.string(),
  fileType: z.enum(['code', 'text', 'other']).optional(),
})

const BlobsBodySchema = z.array(BlobPayloadSchema).min(1).max(100)

/**
 * Embeds a single text with the fallback chain:
 *   whole-file → function-chunker → fixed(1500) → fixed(800)
 * Returns an object with indexed chunk count and a flag indicating success.
 */
async function embedAndStore(
  blobHash: string,
  path: string,
  size: number,
  text: string,
  fileType: 'code' | 'text' | 'other',
  activeProvider: EmbeddingProvider,
  chunkerStrategy: ChunkStrategy,
): Promise<{ indexed: boolean; chunks: number }> {
  const useChunking = chunkerStrategy !== 'file'

  if (useChunking) {
    const chunker = createChunker(chunkerStrategy, {})
    const blobChunks = chunker.chunk(text, path)
    storeBlobRecord({ blobHash, size, path, content: text })
    let allOk = true
    let chunkCount = 0
    for (const chunk of blobChunks) {
      try {
        const emb = await activeProvider.embed(chunk.content)
        storeChunk({ blobHash, startLine: chunk.startLine, endLine: chunk.endLine, model: activeProvider.model, embedding: emb })
        chunkCount++
      } catch (err) {
        logger.error(`Chunk embed failed for ${blobHash} lines ${chunk.startLine}-${chunk.endLine}: ${err instanceof Error ? err.message : String(err)}`)
        allOk = false
      }
    }
    return { indexed: allOk, chunks: chunkCount }
  }

  // Whole-file embedding with fallback chain
  try {
    const embedding = await activeProvider.embed(text)
    storeBlob({ blobHash, size, path, model: activeProvider.model, embedding, fileType, content: text })
    return { indexed: true, chunks: 0 }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (typeof msg !== 'string' || !/context|input length|exceeds the context/i.test(msg)) {
      throw err
    }
  }

  // Fallback 1: function chunker
  const fallbackChunker = createChunker('function', {})
  const blobChunks = fallbackChunker.chunk(text, path)
  storeBlobRecord({ blobHash, size, path, content: text })
  let allOk = true
  let chunkCount = 0

  for (const chunk of blobChunks) {
    let chunkEmbedding: number[]
    try {
      chunkEmbedding = await activeProvider.embed(chunk.content)
    } catch (err) {
      const msg3 = err instanceof Error ? err.message : String(err)
      if (typeof msg3 !== 'string' || !/context|input length|exceeds the context/i.test(msg3)) {
        logger.error(`Chunk embed failed for ${blobHash}: ${msg3}`)
        allOk = false
        continue
      }

      // Fallback 2: fixed-size windows
      const fixedSizes = [1500, 800]
      let fixedSucceeded = false
      for (const size of fixedSizes) {
        const fixedChunker = createChunker('fixed', { windowSize: size, overlap: 200 })
        const subChunks = fixedChunker.chunk(chunk.content, path)
        let subAllOk = true
        for (const sub of subChunks) {
          try {
            const subEmb = await activeProvider.embed(sub.content)
            const absStart = chunk.startLine + sub.startLine - 1
            const absEnd = chunk.startLine + sub.endLine - 1
            storeChunk({ blobHash, startLine: absStart, endLine: absEnd, model: activeProvider.model, embedding: subEmb })
            chunkCount++
          } catch {
            subAllOk = false
          }
        }
        if (subAllOk) { fixedSucceeded = true; break }
      }
      if (!fixedSucceeded) allOk = false
      continue
    }

    storeChunk({ blobHash, startLine: chunk.startLine, endLine: chunk.endLine, model: activeProvider.model, embedding: chunkEmbedding })
    chunkCount++
  }

  return { indexed: allOk, chunks: chunkCount }
}

export interface BlobsRouterDeps {
  textProvider: EmbeddingProvider
  codeProvider?: EmbeddingProvider
  chunkerStrategy: ChunkStrategy
  concurrency: number
}

export function blobsRouter(deps: BlobsRouterDeps): Router {
  const { textProvider, codeProvider, chunkerStrategy, concurrency } = deps
  const router = Router()
  const routingProvider = codeProvider ? new RoutingProvider(textProvider, codeProvider) : null
  const limit = createLimiter(concurrency)

  // POST /blobs/check — returns which hashes the server does NOT have yet
  router.post('/check', async (req, res) => {
    const parsed = CheckBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const missing = [...await filterNewBlobs(parsed.data.hashes)]
    res.json({ missing })
  })

  // POST /blobs — receive raw blob payloads, embed & store
  router.post('/', async (req, res) => {
    const parsed = BlobsBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }

    let indexed = 0
    let skipped = 0
    let failed = 0

    // Filter blobs the server already has
    const hashes = parsed.data.map((b) => b.blobHash)
    const newSet = await filterNewBlobs(hashes)

    await Promise.all(
      parsed.data.map((payload) =>
        limit(async () => {
          if (!newSet.has(payload.blobHash)) {
            skipped++
            return
          }

          const fileType = payload.fileType ?? 'other'
          const activeProvider = routingProvider
            ? routingProvider.providerForFile(payload.path)
            : textProvider

          try {
            await embedAndStore(
              payload.blobHash,
              payload.path,
              payload.size,
              payload.content,
              fileType,
              activeProvider,
              chunkerStrategy,
            )
            indexed++
          } catch (err) {
            logger.error(`Failed to embed/store blob ${payload.blobHash}: ${err instanceof Error ? err.message : String(err)}`)
            failed++
          }
        }),
      ),
    )

    res.json({ indexed, skipped, failed })
  })

  return router
}
