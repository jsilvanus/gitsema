export interface AsyncQueueOptions {
  /** Max items buffered before pushAsync() blocks. 0 = unbounded (default). */
  maxBufferSize?: number
}

export class AsyncQueue<T> {
  private items: T[] = []
  private resolvers: Array<(v: IteratorResult<T | null>) => void> = []
  private waiters: Array<() => void> = []
  private closed = false
  private error: Error | null = null
  private readonly maxBufferSize: number

  constructor(options: AsyncQueueOptions = {}) {
    this.maxBufferSize = options.maxBufferSize ?? 0
  }

  /** Synchronous push — does not enforce backpressure. Use pushAsync() for bounded queues. */
  push(item: T) {
    if (this.closed) throw new Error('Queue closed')
    if (this.resolvers.length > 0) {
      const r = this.resolvers.shift()!
      r({ value: item, done: false })
    } else {
      this.items.push(item)
    }
  }

  /**
   * Async push that blocks the caller when the buffer is at capacity.
   * Returns immediately when the queue has space or a waiting consumer picks up the item.
   */
  async pushAsync(item: T): Promise<void> {
    if (this.closed) throw new Error('Queue closed')
    // If a consumer is waiting, hand off directly
    if (this.resolvers.length > 0) {
      const r = this.resolvers.shift()!
      r({ value: item, done: false })
      return
    }
    // Wait until there is room
    if (this.maxBufferSize > 0) {
      while (this.items.length >= this.maxBufferSize) {
        await new Promise<void>((resolve) => { this.waiters.push(resolve) })
        if (this.closed) throw new Error('Queue closed')
      }
    }
    this.items.push(item)
  }

  /**
   * Signal an error to all waiting consumers. Any subsequent shift() call will throw.
   */
  pushError(err: Error): void {
    this.error = err
    this.closed = true
    while (this.resolvers.length > 0) {
      const r = this.resolvers.shift()!
      // Resolve with done=true; consumer will see the error on next shift()
      r({ value: null, done: true })
    }
    while (this.waiters.length > 0) {
      this.waiters.shift()!()
    }
  }

  close() {
    this.closed = true
    while (this.resolvers.length > 0) {
      const r = this.resolvers.shift()!
      r({ value: null, done: true })
    }
    while (this.waiters.length > 0) {
      this.waiters.shift()!()
    }
  }

  /** Returns next item, or null when the queue is closed. Throws if pushError() was called. */
  async shift(): Promise<T | null> {
    if (this.error) throw this.error
    if (this.items.length > 0) {
      const item = this.items.shift()!
      // Unblock any waiting producers
      if (this.waiters.length > 0) this.waiters.shift()!()
      return item
    }
    if (this.closed) {
      if (this.error) throw this.error
      return null
    }
    return await new Promise<T | null>((resolve) => {
      this.resolvers.push((res) => {
        if (res.done) resolve(null)
        else resolve(res.value as T)
      })
    })
  }
}
