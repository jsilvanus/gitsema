import type { Embedding } from '../models/types.js'
import type { EmbeddingProvider } from './provider.js'
import { getFileCategory } from './fileType.js'

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
   */
  async embedFile(text: string, filePath: string): Promise<Embedding> {
    return this.providerForFile(filePath).embed(text)
  }

  /**
   * Embeds a query string (no file context).
   * Uses the text provider because queries are natural-language prose.
   */
  async embed(text: string): Promise<Embedding> {
    return this.textProvider.embed(text)
  }
}
