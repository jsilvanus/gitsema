import { describe, it, expect, vi, afterEach } from 'vitest'
import { registerTool, setMcpRemoteConfig } from '../src/mcp/registerTool.js'

afterEach(() => {
  vi.unstubAllGlobals()
  setMcpRemoteConfig(null)
})

function fakeServer() {
  const handlers = new Map<string, (args: any) => Promise<any>>()
  return {
    server: { tool: (name: string, _d: string, _s: any, fn: any) => handlers.set(name, fn) },
    handlers,
  }
}

describe('registerTool remote delegation (Phase 113)', () => {
  it('calls the local handler when no remote config is set', async () => {
    const { server, handlers } = fakeServer()
    const localHandler = vi.fn(async () => ({ content: [{ type: 'text', text: 'local' }] }))
    registerTool(server as any, 'my_tool', 'desc', {}, localHandler)

    const result = await handlers.get('my_tool')!({ foo: 'bar' })
    expect(localHandler).toHaveBeenCalled()
    expect(result).toEqual({ content: [{ type: 'text', text: 'local' }] })
  })

  it('delegates to the remote server via callRemote when a remote config is set', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('http://localhost:4242/api/v1/protocol/mcp.my_tool')
      return new Response(JSON.stringify({ result: { content: [{ type: 'text', text: 'remote' }] } }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    setMcpRemoteConfig({ url: 'http://localhost:4242' })

    const { server, handlers } = fakeServer()
    const localHandler = vi.fn(async () => ({ content: [{ type: 'text', text: 'local' }] }))
    registerTool(server as any, 'my_tool', 'desc', {}, localHandler)

    const result = await handlers.get('my_tool')!({ foo: 'bar' })
    expect(localHandler).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ content: [{ type: 'text', text: 'remote' }] })
  })

  it('returns an error content block when the remote call fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
    setMcpRemoteConfig({ url: 'http://localhost:4242' })

    const { server, handlers } = fakeServer()
    registerTool(server as any, 'my_tool', 'desc', {}, vi.fn())

    const result = await handlers.get('my_tool')!({})
    expect(result.content[0].text).toMatch(/Error:.*Remote protocol error 500/)
  })
})
