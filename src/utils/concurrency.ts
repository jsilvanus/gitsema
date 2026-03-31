import pLimit from 'p-limit'

export type Limiter = ReturnType<typeof pLimit>

/**
 * Creates a concurrency limiter that allows at most `concurrency` tasks to
 * run simultaneously. Wrap async tasks with the returned function to
 * automatically queue and throttle execution.
 *
 * @example
 * const limit = createLimiter(4)
 * await Promise.all(items.map(item => limit(() => processItem(item))))
 */
export function createLimiter(concurrency: number): Limiter {
  return pLimit(concurrency)
}
