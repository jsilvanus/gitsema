import { createServer } from 'node:http'
import { buildProvider } from '../../core/embedding/providerFactory.js'
import type { EmbeddingProvider } from '../../core/embedding/provider.js'
import type { ChunkStrategy } from '../../core/chunking/chunker.js'
import { createApp } from '../../server/app.js'
import { logger } from '../../utils/logger.js'

export interface ServeCommandOptions {
  port?: string
  key?: string
  chunker?: string
  concurrency?: string
}

function buildProviderOrExit(providerType: string, model: string): EmbeddingProvider {
  try {
    return buildProvider(providerType, model)
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
    throw err
  }
}

export async function serveCommand(options: ServeCommandOptions): Promise<void> {
  // --key overrides GITSEMA_SERVE_KEY env var
  if (options.key) process.env.GITSEMA_SERVE_KEY = options.key

  const port = options.port !== undefined
    ? parseInt(options.port, 10)
    : parseInt(process.env.GITSEMA_SERVE_PORT ?? '4242', 10)

  if (isNaN(port) || port < 1 || port > 65535) {
    console.error('Error: --port must be a valid port number (1–65535)')
    process.exit(1)
  }

  const concurrency = options.concurrency !== undefined
    ? parseInt(options.concurrency, 10)
    : 4
  if (isNaN(concurrency) || concurrency < 1) {
    console.error('Error: --concurrency must be a positive integer')
    process.exit(1)
  }

  let chunkerStrategy: ChunkStrategy = 'file'
  if (options.chunker !== undefined) {
    if (options.chunker !== 'file' && options.chunker !== 'function' && options.chunker !== 'fixed') {
      console.error('Error: --chunker must be one of: file, function, fixed')
      process.exit(1)
    }
    chunkerStrategy = options.chunker as ChunkStrategy
  }

  const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
  const textModel = process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
  const codeModel = process.env.GITSEMA_CODE_MODEL ?? textModel

  const textProvider = buildProviderOrExit(providerType, textModel)
  const codeProvider = codeModel !== textModel ? buildProviderOrExit(providerType, codeModel) : undefined

  const app = createApp({ textProvider, codeProvider, chunkerStrategy, concurrency })
  const server = createServer(app)

  await new Promise<void>((resolve, reject) => {
    server.on('error', reject)
    server.listen(port, () => {
      const authEnabled = !!process.env.GITSEMA_SERVE_KEY
      console.log(`gitsema server listening on port ${port}`)
      console.log(`  Provider: ${providerType}`)
      if (codeProvider) {
        console.log(`  Text model: ${textModel}`)
        console.log(`  Code model: ${codeModel}`)
      } else {
        console.log(`  Model: ${textModel}`)
      }
      console.log(`  Chunker: ${chunkerStrategy}`)
      console.log(`  Concurrency: ${concurrency}`)
      console.log(`  Auth: ${authEnabled ? 'enabled (GITSEMA_SERVE_KEY)' : 'disabled'}`)
      logger.info('API base: /api/v1')
      resolve()
    })
  })

  // Keep the process alive — server runs until interrupted
  await new Promise<void>(() => {})
}
