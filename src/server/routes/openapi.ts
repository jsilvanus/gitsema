/**
 * OpenAPI specification endpoint (P2 operational readiness).
 *
 * Generates an OpenAPI 3.1.0 JSON spec from the Zod schemas already defined
 * in the search, evolution, and analysis route handlers.
 *
 * Endpoints exposed:
 *   GET /openapi.json   — machine-readable spec
 *   GET /docs           — Swagger UI (no npm package required; loaded from CDN)
 *
 * The spec is generated lazily on first request and cached in memory.
 */

import { Router } from 'express'
import { OpenApiGeneratorV31, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Extend Zod with openapi() method (required by zod-to-openapi)
// ---------------------------------------------------------------------------
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi'
extendZodWithOpenApi(z)

// ---------------------------------------------------------------------------
// Registry: register every schema we want to appear in the spec
// ---------------------------------------------------------------------------
const registry = new OpenAPIRegistry()

// ---- Shared components -----------------------------------------------------

const BlobResultSchema = registry.register(
  'BlobResult',
  z.object({
    blobHash: z.string().openapi({ description: 'Git blob SHA-1' }),
    path: z.string().openapi({ description: 'File path' }),
    score: z.number().openapi({ description: 'Similarity score [0, 1]' }),
    firstSeen: z.string().optional().openapi({ description: 'ISO-8601 timestamp of first commit' }),
    summary: z.string().optional().openapi({ description: 'Short content excerpt' }),
  }),
)

const ErrorSchema = registry.register(
  'Error',
  z.object({
    error: z.string().openapi({ description: 'Error message' }),
    details: z.unknown().optional(),
  }),
)

const TooManyRequestsSchema = registry.register(
  'TooManyRequests',
  z.object({
    error: z.literal('Too Many Requests'),
    retryAfter: z.number().int().openapi({ description: 'Seconds until the rate-limit window resets' }),
  }),
)

// ---- /search ---------------------------------------------------------------

const SearchBodySchema = registry.register(
  'SearchBody',
  z.object({
    query: z.string().min(1).openapi({ description: 'Natural-language query' }),
    top: z.number().int().positive().optional().default(10).openapi({ description: 'Maximum results to return' }),
    recent: z.boolean().optional().default(false).openapi({ description: 'Blend recency into the score' }),
    alpha: z.number().min(0).max(1).optional().default(0.8).openapi({ description: 'Cosine weight in blended score' }),
    before: z.string().optional().openapi({ description: 'ISO date — only blobs first seen before this date' }),
    after: z.string().optional().openapi({ description: 'ISO date — only blobs first seen after this date' }),
    hybrid: z.boolean().optional().default(false).openapi({ description: 'Enable BM25 + vector hybrid search' }),
    bm25Weight: z.number().min(0).max(1).optional().openapi({ description: 'BM25 weight in hybrid score (default 0.3)' }),
    branch: z.string().optional().openapi({ description: 'Restrict results to blobs seen on this branch' }),
    chunks: z.boolean().optional().default(false).openapi({ description: 'Include chunk-level embeddings' }),
    rendered: z.boolean().optional().default(false).openapi({ description: 'Return human-readable text instead of JSON array' }),
  }),
)

registry.registerPath({
  method: 'post',
  path: '/api/v1/search',
  tags: ['Search'],
  summary: 'Vector-similarity search',
  request: { body: { content: { 'application/json': { schema: SearchBodySchema } } } },
  responses: {
    200: { description: 'Search results', content: { 'application/json': { schema: z.array(BlobResultSchema) } } },
    400: { description: 'Invalid request body', content: { 'application/json': { schema: ErrorSchema } } },
    429: { description: 'Rate limit exceeded', content: { 'application/json': { schema: TooManyRequestsSchema } } },
  },
})

// ---- /search/first-seen ----------------------------------------------------

const FirstSeenBodySchema = registry.register(
  'FirstSeenBody',
  z.object({
    query: z.string().min(1).openapi({ description: 'Natural-language query' }),
    top: z.number().int().positive().optional().default(10),
    hybrid: z.boolean().optional().default(false),
    branch: z.string().optional(),
    rendered: z.boolean().optional().default(false),
  }),
)

registry.registerPath({
  method: 'post',
  path: '/api/v1/search/first-seen',
  tags: ['Search'],
  summary: 'Find when a concept first appeared (chronological order)',
  request: { body: { content: { 'application/json': { schema: FirstSeenBodySchema } } } },
  responses: {
    200: { description: 'Results sorted oldest-first', content: { 'application/json': { schema: z.array(BlobResultSchema) } } },
    400: { description: 'Invalid request body', content: { 'application/json': { schema: ErrorSchema } } },
    429: { description: 'Rate limit exceeded', content: { 'application/json': { schema: TooManyRequestsSchema } } },
  },
})

// ---- /evolution/file -------------------------------------------------------

const FileEvolutionBodySchema = registry.register(
  'FileEvolutionBody',
  z.object({
    path: z.string().min(1).openapi({ description: 'Repository-relative file path' }),
    threshold: z.number().min(0).max(1).optional().default(0.3).openapi({ description: 'Cosine distance threshold for flagging large changes' }),
    branch: z.string().optional(),
    includeContent: z.boolean().optional().default(false),
  }),
)

registry.registerPath({
  method: 'post',
  path: '/api/v1/evolution/file',
  tags: ['Evolution'],
  summary: 'Semantic drift timeline for a single file',
  request: { body: { content: { 'application/json': { schema: FileEvolutionBodySchema } } } },
  responses: {
    200: { description: 'Evolution timeline JSON', content: { 'application/json': { schema: z.array(z.unknown()) } } },
    400: { description: 'Invalid request body', content: { 'application/json': { schema: ErrorSchema } } },
    429: { description: 'Rate limit exceeded', content: { 'application/json': { schema: TooManyRequestsSchema } } },
  },
})

// ---- /evolution/concept ----------------------------------------------------

const ConceptEvolutionBodySchema = registry.register(
  'ConceptEvolutionBody',
  z.object({
    query: z.string().min(1),
    top: z.number().int().positive().optional().default(50),
    threshold: z.number().min(0).max(1).optional().default(0.3),
    includeContent: z.boolean().optional().default(false),
  }),
)

registry.registerPath({
  method: 'post',
  path: '/api/v1/evolution/concept',
  tags: ['Evolution'],
  summary: 'Trace how a concept evolved across the whole codebase history',
  request: { body: { content: { 'application/json': { schema: ConceptEvolutionBodySchema } } } },
  responses: {
    200: { description: 'Concept evolution timeline', content: { 'application/json': { schema: z.array(z.unknown()) } } },
    400: { description: 'Invalid request body', content: { 'application/json': { schema: ErrorSchema } } },
    429: { description: 'Rate limit exceeded', content: { 'application/json': { schema: TooManyRequestsSchema } } },
  },
})

// ---- /status ---------------------------------------------------------------

registry.registerPath({
  method: 'get',
  path: '/api/v1/status',
  tags: ['Status'],
  summary: 'Return index statistics',
  responses: {
    200: {
      description: 'Index statistics',
      content: {
        'application/json': {
          schema: z.object({
            blobs: z.number().int(),
            embeddings: z.number().int(),
            dbPath: z.string(),
            schemaVersion: z.number().int(),
          }),
        },
      },
    },
    429: { description: 'Rate limit exceeded', content: { 'application/json': { schema: TooManyRequestsSchema } } },
  },
})

// ---- /metrics --------------------------------------------------------------

registry.registerPath({
  method: 'get',
  path: '/metrics',
  tags: ['Observability'],
  summary: 'Prometheus metrics scrape endpoint',
  responses: {
    200: { description: 'text/plain Prometheus exposition format', content: { 'text/plain': { schema: z.string() } } },
    401: { description: 'Unauthorized (GITSEMA_SERVE_KEY set, no valid token)', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

// ---------------------------------------------------------------------------
// Generate the spec (lazy, cached)
// ---------------------------------------------------------------------------
let _cachedSpec: Record<string, unknown> | null = null

function generateSpec(): Record<string, unknown> {
  if (_cachedSpec) return _cachedSpec

  const generator = new OpenApiGeneratorV31(registry.definitions)
  _cachedSpec = generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'gitsema HTTP API',
      version: '1.0.0',
      description:
        'Content-addressed semantic index for Git repositories. ' +
        'Exposes semantic search, evolution analysis, and operational endpoints.',
      contact: { url: 'https://github.com/jsilvanus/gitsema' },
      license: { name: 'MIT' },
    },
    servers: [{ url: '/api/v1', description: 'Local server' }],
  }) as unknown as Record<string, unknown>

  return _cachedSpec
}

// ---------------------------------------------------------------------------
// Swagger UI HTML (CDN — no extra npm package required)
// ---------------------------------------------------------------------------
function swaggerHtml(specUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>gitsema API docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: ${JSON.stringify(specUrl)},
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'StandaloneLayout',
    })
  </script>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
export function openapiRouter(): Router {
  const router = Router()

  router.get('/openapi.json', (_req, res) => {
    res.json(generateSpec())
  })

  router.get('/docs', (_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(swaggerHtml('/openapi.json'))
  })

  return router
}

/** Exported for tests */
export { generateSpec }
