import { extname } from 'node:path'

/**
 * File categories for routing to the appropriate embedding model.
 */
export type FileCategory = 'code' | 'text' | 'other'

/**
 * Extensions considered source code. These are routed to the code-aware model.
 */
export const CODE_EXTENSIONS = new Set([
  // Web
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  // Systems
  '.c', '.h', '.cpp', '.cc', '.cxx', '.hpp', '.hh',
  '.rs', '.go',
  // JVM
  '.java', '.kt', '.kts', '.scala', '.groovy',
  // .NET
  '.cs', '.fs', '.vb',
  // Scripting
  '.py', '.rb', '.php', '.lua', '.pl', '.pm',
  // Shell
  '.sh', '.bash', '.zsh', '.fish', '.ps1',
  // Data / query
  '.sql', '.graphql', '.gql',
  // Config-as-code
  '.tf', '.hcl',
  // Other
  '.swift', '.dart', '.ex', '.exs', '.erl', '.elm',
  '.hs', '.clj', '.cljs', '.r', '.m', '.jl',
])

/**
 * Extensions considered prose / documentation. These are routed to the text model.
 */
export const TEXT_EXTENSIONS = new Set([
  '.md', '.mdx', '.txt', '.rst', '.adoc', '.asciidoc',
  '.tex', '.org', '.wiki',
])

/**
 * Returns the file category for a given file path based on its extension.
 *
 * - `'code'`  — source code; route to the code-aware embedding model
 * - `'text'`  — prose / documentation; route to the text embedding model
 * - `'other'` — everything else (images, binaries, config, etc.)
 */
export function getFileCategory(filePath: string): FileCategory {
  const ext = extname(filePath).toLowerCase()
  if (CODE_EXTENSIONS.has(ext)) return 'code'
  if (TEXT_EXTENSIONS.has(ext)) return 'text'
  return 'other'
}
