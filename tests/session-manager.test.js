import { describe, it, expect, vi } from 'vitest'
import { createSessionManager } from '../src/server/session-manager.js'
import { UsageError } from '../src/core/usage.js'
import { AuthError } from '../src/core/auth.js'

const fakePage = ({ isClosed = false } = {}) => ({
  waitForTimeout: vi.fn(async () => {}),
  isClosed: () => isClosed,
})
const fakeOpen = (overrides = {}) => async () => ({
  page: fakePage(),
  context: { close: vi.fn(async () => {}) },
  collectors: { consoleErrors: [], failedRequests: [], crashCount: () => 0 },
  authMode: 'cookie',
  baseUrl: 'http://127.0.0.1:3080/',
  ...overrides,
})

describe('createSessionManager (保活语义)', () => {
  it('NO_SESSION before any open; current() throws the structured usage error', () => {
    const m = createSessionManager()
    expect(() => m.current()).toThrow(UsageError)
    try { m.current() } catch (e) {
      expect(e.code).toBe('NO_SESSION')
    }
  })

  it('opens via injected impl and applies the SPA wait', async () => {
    const open = vi.fn(fakeOpen())
    const m = createSessionManager({ open, spaWaitMs: 6000 })
    const s = await m.open({})
    expect(open).toHaveBeenCalledTimes(1)
    expect(s.authMode).toBe('cookie')
    expect(s.page.waitForTimeout).toHaveBeenCalledWith(6000)
  })

  it('reuses the same session when target resolves identically', async () => {
    const open = vi.fn(fakeOpen())
    const m = createSessionManager({ open })
    const a = await m.open({})
    const b = await m.open({})
    expect(open).toHaveBeenCalledTimes(1)
    expect(b).toBe(a)
    expect(a.context.close).not.toHaveBeenCalled()
  })

  it('reopens (close old → open new) when baseUrl differs', async () => {
    const open = vi.fn(fakeOpen())
    const m = createSessionManager({ open })
    const a = await m.open({ baseUrl: 'http://a/' })
    const b = await m.open({ baseUrl: 'http://b/' })
    expect(open).toHaveBeenCalledTimes(2)
    expect(a.context.close).toHaveBeenCalled()
    expect(b).not.toBe(a)
  })

  it('auth failure leaves no dangling session', async () => {
    const open = vi.fn(async () => { throw new AuthError('NO_TOKEN', 'hint') })
    const m = createSessionManager({ open })
    await expect(m.open({})).rejects.toThrow(AuthError)
    expect(() => m.current()).toThrow(UsageError)
  })

  it('close() closes the context and empties state; idempotent when empty', async () => {
    const open = vi.fn(fakeOpen())
    const m = createSessionManager({ open })
    const s = await m.open({})
    await m.close()
    expect(s.context.close).toHaveBeenCalledTimes(1)
    expect(() => m.current()).toThrow(UsageError)
    await m.close() // no-op, no throw
  })
})

describe('createSessionManager (坏状态自救, issue #2)', () => {
  it('force: true closes the old session even when target resolves identically', async () => {
    const open = vi.fn(fakeOpen())
    const m = createSessionManager({ open })
    const a = await m.open({})
    const b = await m.open({ force: true })
    expect(open).toHaveBeenCalledTimes(2)
    expect(a.context.close).toHaveBeenCalled()
    expect(b).not.toBe(a)
  })
  it('auto-reopens when the stored page is closed (dead signal)', async () => {
    const deadPage = fakePage({ isClosed: true })
    let call = 0
    const open = vi.fn(async () => {
      call += 1
      return {
        page: call === 1 ? deadPage : fakePage(),
        context: { close: vi.fn(async () => {}) },
        collectors: { consoleErrors: [], failedRequests: [], crashCount: () => 0 },
        authMode: 'cookie',
        baseUrl: 'http://127.0.0.1:3080/',
      }
    })
    const m = createSessionManager({ open })
    await m.open({})
    const b = await m.open({})
    expect(open).toHaveBeenCalledTimes(2)
    expect(b.page.isClosed()).toBe(false)
  })
  it('auto-reopens when the renderer crashed (crashCount > 0)', async () => {
    let crashes = 0
    const first = {
      page: fakePage(),
      context: { close: vi.fn(async () => {}) },
      collectors: { consoleErrors: [], failedRequests: [], crashCount: () => (crashes > 0 ? 1 : 0) },
      authMode: 'cookie',
      baseUrl: 'http://127.0.0.1:3080/',
    }
    const open = vi.fn(async () => (open.mock.calls.length === 1 ? first : { ...first, page: fakePage() }))
    const m = createSessionManager({ open })
    const a = await m.open({})
    crashes = 1 // 会话建立后页面崩溃
    const b = await m.open({})
    expect(open).toHaveBeenCalledTimes(2)
    expect(a.context.close).toHaveBeenCalled()
    expect(b).not.toBe(a)
  })
  it('an empty-looking but alive session is still reused (no false-positive reopen)', async () => {
    const open = vi.fn(fakeOpen())
    const m = createSessionManager({ open })
    const a = await m.open({})
    const b = await m.open({})
    expect(open).toHaveBeenCalledTimes(1)
    expect(b).toBe(a)
  })
})
