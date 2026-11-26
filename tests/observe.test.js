import { describe, it, expect } from 'vitest'
import { createCollectors, failedRequestEntry } from '../src/core/observe.js'

const makePage = () => {
  const handlers = {}
  return { page: { on: (event, fn) => { handlers[event] = fn } }, handlers }
}

describe('createCollectors', () => {
  it('collects console errors, capped per message by consoleSlice', () => {
    const { page, handlers } = makePage()
    const { consoleErrors } = createCollectors(page, { consoleSlice: 5 })
    handlers.console({ type: () => 'error', text: () => 'x'.repeat(9) })
    handlers.console({ type: () => 'log', text: () => 'not an error' })
    expect(consoleErrors).toEqual(['x'.repeat(5)])
  })
  it('collects failed requests through failedRequestEntry, skips < 400', () => {
    const { page, handlers } = makePage()
    const { failedRequests } = createCollectors(page)
    handlers.response({ status: () => 200, url: () => 'http://h/ok?token=secret' })
    handlers.response({ status: () => 500, url: () => 'http://h/api/x?token=secret' })
    expect(failedRequests).toEqual(['HTTP 500 http://h/api/x?token=***'])
  })
  it('counts renderer crashes, exposed via crashCount()', () => {
    const { page, handlers } = makePage()
    const c = createCollectors(page)
    expect(c.crashCount()).toBe(0)
    handlers.crash()
    handlers.crash()
    expect(c.crashCount()).toBe(2)
  })
  it('records network-layer failures as NET entries (issue #10: 无 response 事件的失败)', () => {
    const { page, handlers } = makePage()
    const { failedRequests } = createCollectors(page)
    handlers.requestfailed({ url: () => 'http://127.0.0.1:9/?token=secret', failure: () => ({ errorText: 'net::ERR_CONNECTION_REFUSED' }) })
    handlers.requestfailed({ url: () => 'http://gone.invalid/', failure: () => ({ errorText: 'net::ERR_NAME_NOT_RESOLVED' }) })
    handlers.requestfailed({ url: () => 'http://x/', failure: () => null })
    expect(failedRequests).toEqual([
      'NET net::ERR_CONNECTION_REFUSED http://127.0.0.1:9/?token=***',
      'NET net::ERR_NAME_NOT_RESOLVED http://gone.invalid/',
      'NET unknown http://x/',
    ])
  })
})

describe('failedRequestEntry (guards re-exported from mask.test coverage)', () => {
  it('returns null for successful responses', () => {
    expect(failedRequestEntry({ status: 200, url: 'http://h/' })).toBeNull()
  })
})
