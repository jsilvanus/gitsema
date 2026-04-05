import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const DEFAULT_MAX_SIZE = 200 * 1024 // 200 KB

/**
 * Returns the raw content of a blob by hash.
 * Returns null if the blob exceeds maxBytes.
 *
 * Uses a single `git cat-file --batch` invocation to get both the size and
 * content in one subprocess call, avoiding the two-fork overhead of the
 * previous `-s` + `blob` approach.
 */
export async function showBlob(
  blobHash: string,
  repoPath: string = '.',
  maxBytes: number = DEFAULT_MAX_SIZE,
): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', ['cat-file', '--batch'], {
      cwd: repoPath,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const chunks: Buffer[] = []
    let header = ''
    let headerParsed = false
    let expectedSize = -1
    let received = 0
    let done = false

    proc.stdout.on('data', (chunk: Buffer) => {
      if (done) return
      chunks.push(chunk)
      received += chunk.length

      if (!headerParsed) {
        // The header line ends with '\n': "<hash> blob <size>\n"
        const all = Buffer.concat(chunks)
        const nl = all.indexOf(0x0a)  // '\n'
        if (nl === -1) return  // header not yet complete
        header = all.slice(0, nl).toString('ascii')
        if (header.includes('missing')) {
          done = true
          proc.stdin.end()
          resolve(null)
          return
        }
        const parts = header.split(' ')
        expectedSize = parseInt(parts[2], 10)
        if (expectedSize > maxBytes) {
          done = true
          proc.stdin.end()
          proc.kill()
          resolve(null)
          return
        }
        headerParsed = true
        // content starts after the '\n' following the header
        const content = all.slice(nl + 1)
        chunks.length = 0
        chunks.push(content)
        received = content.length
      }

      if (headerParsed && received >= expectedSize) {
        done = true
        const content = Buffer.concat(chunks).slice(0, expectedSize)
        proc.stdin.end()
        resolve(content)
      }
    })

    proc.stdout.on('end', () => {
      if (!done) {
        done = true
        if (headerParsed && expectedSize >= 0) {
          resolve(Buffer.concat(chunks).slice(0, expectedSize))
        } else {
          resolve(null)
        }
      }
    })

    proc.on('error', (err) => {
      if (!done) { done = true; reject(err) }
    })

    proc.stderr.on('data', () => { /* swallow */ })

    // Send the hash to git cat-file --batch stdin
    proc.stdin.write(`${blobHash}\n`)
  })
}
