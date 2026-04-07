import { describe, it, expect } from 'vitest'
import { AsyncQueue } from '../src/utils/asyncQueue.js'

describe('AsyncQueue', () => {
  it('push/shift works and close yields null', async () => {
    const q = new AsyncQueue<number>()
    q.push(1)
    q.push(2)
    const a = await q.shift()
    expect(a).toBe(1)
    const b = await q.shift()
    expect(b).toBe(2)
    // now close and ensure shift returns null
    q.close()
    const c = await q.shift()
    expect(c).toBeNull()
  })

  it('await shift waits for pushed items', async () => {
    const q = new AsyncQueue<number>()
    const p = q.shift()
    setTimeout(() => q.push(42), 10)
    const v = await p
    expect(v).toBe(42)
    q.close()
  })
})
