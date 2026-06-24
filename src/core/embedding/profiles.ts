/**
 * Multi-profile embedding serving (Phase 128 / locked-model-set-plan.md §4.1).
 *
 * A `gitsema tools serve` deployment can offer several named embedding
 * profiles at once instead of one process-wide model pair. Each profile is
 * resolved to its own provider pair at server startup; a repo is pinned to
 * exactly one profile at first index and stays pinned forever (see
 * `repos.profileName` in `repoRegistry.ts`).
 */

import { z } from 'zod'
import { buildProvider } from './providerFactory.js'
import type { EmbeddingProvider } from './provider.js'
import { getConfigValue } from '../config/configManager.js'

export interface EmbeddingProfileConfig {
  name: string
  provider: string
  textModel: string
  codeModel?: string
  httpUrl?: string
  apiKey?: string
}

export interface EmbeddingProviderPair {
  textProvider: EmbeddingProvider
  codeProvider?: EmbeddingProvider
}

/** Alphanumeric + hyphens/underscores, 1–64 chars — same shape as other server-side name fields (e.g. dbLabel). */
export const PROFILE_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/

export const EmbeddingProfileSchema = z.object({
  name: z.string().regex(PROFILE_NAME_RE, 'profile name must be 1-64 alphanumeric/hyphen/underscore characters'),
  provider: z.string().min(1).max(32),
  textModel: z.string().min(1).max(256),
  codeModel: z.string().min(1).max(256).optional(),
  httpUrl: z.string().max(2048).optional(),
  apiKey: z.string().max(512).optional(),
}).strict()

const EmbeddingProfileListSchema = z.array(EmbeddingProfileSchema).max(100)

/**
 * Loads the operator-defined list of embedding profiles from
 * `GITSEMA_EMBEDDING_PROFILES` (a JSON array string) or the
 * `embeddingProfiles` config key. Returns an empty array when nothing is
 * configured — callers should fall back to today's single-profile behavior.
 *
 * @throws {Error} when the configured value is malformed JSON, fails schema
 * validation, or contains duplicate profile names.
 */
export function loadEmbeddingProfileConfigs(cwd?: string): EmbeddingProfileConfig[] {
  let raw: unknown
  const envVal = process.env.GITSEMA_EMBEDDING_PROFILES
  if (envVal) {
    try {
      raw = JSON.parse(envVal)
    } catch (err) {
      throw new Error(`GITSEMA_EMBEDDING_PROFILES is not valid JSON: ${err instanceof Error ? err.message : String(err)}`)
    }
  } else {
    raw = getConfigValue('embeddingProfiles', cwd).value
  }

  if (raw === undefined) return []

  const parsed = EmbeddingProfileListSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`Invalid embeddingProfiles config: ${parsed.error.message}`)
  }

  const seen = new Set<string>()
  for (const p of parsed.data) {
    if (seen.has(p.name)) {
      throw new Error(`Duplicate embedding profile name: ${p.name}`)
    }
    seen.add(p.name)
  }

  return parsed.data
}

/**
 * Resolves each configured profile to its own `textProvider`/`codeProvider`
 * pair. Provider construction is cheap (stateless HTTP/Ollama wrappers — see
 * locked-model-set-plan.md §2), so holding N of them in one process is safe.
 *
 * @throws {Error} propagated from `buildProvider` (e.g. a `http` profile missing `httpUrl`).
 */
export function buildProfileProviderMap(profiles: EmbeddingProfileConfig[]): Map<string, EmbeddingProviderPair> {
  const map = new Map<string, EmbeddingProviderPair>()
  for (const p of profiles) {
    const config = { httpUrl: p.httpUrl, apiKey: p.apiKey }
    const textProvider = buildProvider(p.provider, p.textModel, config)
    const codeProvider = p.codeModel && p.codeModel !== p.textModel
      ? buildProvider(p.provider, p.codeModel, config)
      : undefined
    map.set(p.name, { textProvider, codeProvider })
  }
  return map
}
