export class AsyncQueue<T> {
  private items: T[] = []
  private resolvers: Array<(v: IteratorResult<T | null>) => void> = []
  private closed = false

  push(item: T) {
    if (this.closed) throw new Error('Queue closed')
    if (this.resolvers.length > 0) {
      const r = this.resolvers.shift()!
      r({ value: item, done: false })
    } else {
      this.items.push(item)
    }
  }

  close() {
    this.closed = true
    // resolve any pending waits with null to indicate end
    while (this.resolvers.length > 0) {
      const r = this.resolvers.shift()!
      r({ value: null, done: true })
    }
  }

  // Async iterator style consumption: returns next item or null when closed
  async shift(): Promise<T | null> {
    if (this.items.length > 0) {
      return this.items.shift()!
    }
    if (this.closed) return null
    return await new Promise<T | null>((resolve) => {
      this.resolvers.push((res) => {
        if (res.done) resolve(null)
        else resolve(res.value as T)
      })
    })
  }
}
