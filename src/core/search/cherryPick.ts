import { getActiveSession } from '../db/sqlite.js'
import { embedQuery } from '../embedding/embedQuery.js'
import { searchCommits } from './commitSearch.js'
import type { Embedding } from '../models/types.js'

export interface CherryPickOptions {
  topK?: number
  model?: string
}

/**
 * Suggest commit cherry-picks by semantic similarity of commit messages to a query.
 * Query embedding is expected to be precomputed by the caller, or callers can
 * embed via embedQuery when a provider is available.
 */
export function suggestCherryPicks(queryEmbedding: Embedding, options: CherryPickOptions = {}) {
  const { topK = 10, model } = options
  // Delegate to existing commitSearch
  const results = searchCommits(queryEmbedding, { topK, model })
  return results
}
