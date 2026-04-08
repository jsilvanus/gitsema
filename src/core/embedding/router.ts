import { extname } from 'node:path'
import type { Embedding } from '../models/types.js'
import type { EmbeddingProvider } from './provider.js'
import { getFileCategory } from './fileType.js'
import { PrefixedProvider } from './prefixedProvider.js'
import { getModelProfile } from '../config/configManager.js'

/**
 * A provider that routes embedding calls to either a code-aware model or a
 * text model based on the file extension of the source file.
 *
 * For search queries (which have no associated file path) the text provider
 * is used, since queries are natural-language prose.
 */
export class RoutingProvider {
  readonly model: string

  constructor(
    readonly textProvider: EmbeddingProvider,
    readonly codeProvider: EmbeddingProvider,
  ) {
    this.model = `text:${textProvider.model}+code:${codeProvider.model}`
  }

  /**
   * Returns the appropriate provider for the given file path.
   * Falls back to the text provider for unrecognised file types.
   */
  providerForFile(filePath: string): EmbeddingProvider {
    const category = getFileCategory(filePath)
    return category === 'code' ? this.codeProvider : this.textProvider
  }

  /**
   * Embeds the content of a specific file, routing to the correct model.
   *
   * For files in the built-in code/text categories the provider returned by
   * `providerForFile()` already has the correct role prefix baked in (set via
   * `getTextProvider` / `getCodeProvider`).
   *
   * For files with an explicit `extRoles` mapping in the model profile the
   * custom role's prefix is applied instead, stripping any pre-baked prefix to
   * avoid double-prefixing.
   */
  async embedFile(text: string, filePath: string): Promise<Embedding> {
    const base = this.providerForFile(filePath)
    const ext = extname(filePath).toLowerCase()
    const profile = getModelProfile(base.model)
    const customRole = profile.extRoles?.[ext]
    if (customRole !== undefined) {
      const customPrefix = profile.prefixes?.[customRole]
      if (customPrefix !== undefined) {
        // Unwrap any existing PrefixedProvider to avoid double-prefix, then
        // apply the custom role prefix.
        const raw = base instanceof PrefixedProvider ? base.inner : base
        return new PrefixedProvider(raw, customPrefix).embed(text)
      }
    }
    return base.embed(text)
  }

  /**
   * Embeds a query string (no file context).
   * Uses the text provider because queries are natural-language prose.
   */
  async embed(text: string): Promise<Embedding> {
    return this.textProvider.embed(text)
  }
}
