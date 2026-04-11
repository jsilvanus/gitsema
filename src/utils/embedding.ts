/**
 * Shared helpers for deserializing embedding vectors stored as SQLite BLOBs.
 *
 * Prior to §11.4 the same logic was inlined as a private `bufferToEmbedding`
 * function in 13 different files across `src/core/search/`, `src/server/` and
 * `src/cli/`. Keeping one source of truth prevents silent divergence if the
 * storage format (e.g. quantization) ever changes.
 */

/**
 * View a Float32-serialized SQLite blob as a zero-copy Float32Array.
 *
 * The returned array aliases the underlying Node Buffer memory — callers
 * must treat it as read-only for the lifetime of `buf`.
 */
export function bufferToFloat32(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
}

/**
 * Convert a Float32-serialized SQLite blob to a plain `number[]`.
 *
 * Allocates a fresh array and is therefore safe to retain after the source
 * buffer is discarded. Use `bufferToFloat32` for hot paths that only need a
 * read-only view.
 */
export function bufferToEmbedding(buf: Buffer): number[] {
  return Array.from(bufferToFloat32(buf))
}
