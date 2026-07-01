/**
 * Shared per-request model-override mechanism for HTTP analysis routes
 * (Phase 140).
 *
 * The CLI's `--model`/`--text-model`/`--code-model` triplet is available
 * consistently across CLI commands via `src/cli/lib/provider.ts`'s
 * `resolveModels()` + `buildProviderOrExit()`. Eight `analysis.ts` HTTP
 * routes (`clusters`, `change-points`, `author`, `impact`, `semantic-diff`,
 * `semantic-blame`, `triage`, `workflow`) never got the equivalent — this
 * module fixes that gap once instead of eight times.
 *
 * Deliberately does NOT reuse `resolveModels()`/`buildProviderOrExit()`
 * as-is: those helpers mutate `process.env` (`applyModelOverrides`) and call
 * `process.exit()` on failure, both of which are wrong for a long-running,
 * concurrently-serving HTTP process — a per-request env mutation could leak
 * into another in-flight request, and `process.exit()` would kill the
 * server. Instead this mirrors the same *resolution logic* using the
 * explicit `ResolvedConfig` parameter that `buildProvider()` already
 * supports, so no global state is touched.
 */

import { z } from 'zod'
import { buildProvider, type ResolvedConfig } from '../../core/embedding/providerFactory.js'
import type { EmbeddingProvider } from '../../core/embedding/provider.js'

/**
 * Zod fragment for the `{model, textModel, codeModel}` override triplet.
 * Spread into any route's body schema:
 *
 *   const FooBodySchema = z.object({
 *     ...modelOverrideSchema.shape,
 *     query: z.string().min(1),
 *   })
 */
export const modelOverrideSchema = z.object({
  model: z.string().optional(),
  textModel: z.string().optional(),
  codeModel: z.string().optional(),
})

export type ModelOverrideBody = z.infer<typeof modelOverrideSchema>

/** Thrown by `resolveRequestProvider` when provider construction fails (e.g. missing HTTP URL). */
export class ModelOverrideError extends Error {}

/**
 * Resolves a per-request `EmbeddingProvider` from a parsed request body's
 * `{model, textModel, codeModel}` fields, falling back to the router's
 * shared `fallbackProvider` (the server's default `textProvider`) when none
 * of the three overrides are present — preserving prior behavior for
 * requests that don't opt in.
 *
 * Mirrors `resolveModels()`'s env-var fallback chain
 * (`GITSEMA_TEXT_MODEL ?? GITSEMA_MODEL ?? 'nomic-embed-text'`, code model
 * defaulting to the resolved text model) but reads overrides from the
 * request body instead of `process.env`, and passes them through
 * `buildProvider`'s explicit `config` parameter rather than mutating env.
 *
 * @throws {ModelOverrideError} when provider construction fails (e.g.
 *   `GITSEMA_PROVIDER=http` with no `GITSEMA_HTTP_URL` configured).
 */
export function resolveRequestProvider(
  body: ModelOverrideBody,
  fallbackProvider: EmbeddingProvider,
): EmbeddingProvider {
  if (!body.model && !body.textModel && !body.codeModel) {
    return fallbackProvider
  }

  const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
  const textModel =
    body.textModel ?? body.model ??
    process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'

  const config: ResolvedConfig = {
    provider: providerType,
    model: textModel,
    textModel,
    httpUrl: process.env.GITSEMA_HTTP_URL,
    apiKey: process.env.GITSEMA_API_KEY,
  }

  try {
    return buildProvider(providerType, textModel, config)
  } catch (err) {
    throw new ModelOverrideError(err instanceof Error ? err.message : String(err))
  }
}
