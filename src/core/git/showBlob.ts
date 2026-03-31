import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const DEFAULT_MAX_SIZE = 200 * 1024 // 200 KB

/**
 * Returns the raw content of a blob by hash.
 * Returns null if the blob exceeds maxBytes (size check via git cat-file -s).
 */
export async function showBlob(
  blobHash: string,
  repoPath: string = '.',
  maxBytes: number = DEFAULT_MAX_SIZE,
): Promise<Buffer | null> {
  // Check size first to avoid reading large blobs
  const { stdout: sizeOut } = await execFileAsync('git', ['cat-file', '-s', blobHash], {
    cwd: repoPath,
  })
  const size = parseInt(sizeOut.trim(), 10)
  if (size > maxBytes) return null

  const { stdout } = await execFileAsync('git', ['cat-file', 'blob', blobHash], {
    cwd: repoPath,
    encoding: 'buffer',
    maxBuffer: maxBytes + 1024,
  })

  return stdout
}
