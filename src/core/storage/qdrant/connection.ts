/**
 * Qdrant client caching for the storage seam (Phase 103).
 *
 * Clients are cached by `url|apiKey` so repeated `resolveStorageProfile()`
 * calls against the same `storage.vectors.url` share a single client,
 * mirroring the Postgres adapter's cached-pool behavior.
 */

import { QdrantClient } from '@qdrant/js-client-rest'

const clients = new Map<string, QdrantClient>()

/** Returns the cached `QdrantClient` for `url`/`apiKey`, creating it if needed. */
export function getQdrantClient(url: string, apiKey?: string): QdrantClient {
  const key = `${url}|${apiKey ?? ''}`
  let client = clients.get(key)
  if (!client) {
    client = new QdrantClient({ url, apiKey })
    clients.set(key, client)
  }
  return client
}

const verifiedClients = new WeakSet<QdrantClient>()

/**
 * Probe a Qdrant client once (memoized per client) so a bad URL / unreachable
 * server fails with an actionable message pointing at the config key, rather
 * than an opaque client error at the first search/upsert (review9 §7.2).
 */
export async function verifyQdrantClient(client: QdrantClient): Promise<void> {
  if (verifiedClients.has(client)) return
  try {
    await client.getCollections()
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Cannot connect to the Qdrant storage backend ` +
      `(storage.vectors.url / GITSEMA_STORAGE_VECTORS_URL): ${detail}`,
    )
  }
  verifiedClients.add(client)
}

/** Forgets all cached clients (tests). */
export function clearQdrantClients(): void {
  clients.clear()
  // WeakSet entries are dropped with their clients; nothing to clear explicitly.
}
