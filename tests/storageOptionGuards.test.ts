/**
 * The Postgres and Qdrant vector backends do not implement every
 * VectorSearchOptions field. Options that would otherwise be silently dropped
 * and yield WRONG results must throw a clear error instead (review9 §4).
 *
 * These guards run before any DB/client I/O, so the stores can be constructed
 * with stub connections.
 */
import { describe, it, expect } from 'vitest'
import { PgVectorStore } from '../src/core/storage/postgres/vectorStore.js'
import { QdrantVectorStore } from '../src/core/storage/qdrant/vectorStore.js'

const vec = [0.1, 0.2, 0.3]

describe('PgVectorStore.search option guards', () => {
  const store = new PgVectorStore({} as never)

  it('throws on allowedHashes', async () => {
    await expect(
      store.search(vec, { allowedHashes: new Set(['abc']) }),
    ).rejects.toThrow(/allowedHashes/)
  })

  it('does not throw on an empty allowedHashes set', async () => {
    // An empty set imposes no filter, so it must not trip the guard. (It will
    // still fail later trying to use the stub pool — assert only the guard.)
    await expect(
      store.search(vec, { allowedHashes: new Set() }),
    ).rejects.not.toThrow(/allowedHashes/)
  })
})

describe('QdrantVectorStore.search option guards', () => {
  const store = new QdrantVectorStore({} as never, {} as never)

  it('throws on allowedHashes', async () => {
    await expect(
      store.search(vec, { allowedHashes: new Set(['abc']) }),
    ).rejects.toThrow(/allowedHashes/)
  })

  it('throws on negative-example search', async () => {
    await expect(
      store.search(vec, { negativeQueryEmbedding: vec }),
    ).rejects.toThrow(/negative-example/)
  })
})
