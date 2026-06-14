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

/** Forgets all cached clients (tests). */
export function clearQdrantClients(): void {
  clients.clear()
}
