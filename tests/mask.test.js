import { describe, it, expect } from 'vitest'
import { maskToken } from '../src/core/report.js'
import { failedRequestEntry } from '../src/core/observe.js'

describe('maskToken', () => {
  it('masks the token value in a query string', () => {
    expect(maskToken('http://h:3080/?token=abc&x=1')).toBe('http://h:3080/?token=***&x=1')
  })
  it('masks every occurrence', () => {
    expect(maskToken('a?token=1 b?token=2')).toBe('a?token=*** b?token=***')
  })
  it('stops at quote and whitespace', () => {
    expect(maskToken("url?token=abc' rest")).toBe("url?token=***' rest")
    expect(maskToken('url?token=abc rest')).toBe('url?token=*** rest')
  })
  it('handles token at end of string', () => {
    expect(maskToken('http://h/?token=abc')).toBe('http://h/?token=***')
  })
  it('leaves urls without token unchanged', () => {
    expect(maskToken('http://h/?a=1')).toBe('http://h/?a=1')
  })
})

describe('failedRequestEntry', () => {
  it('returns null for status below 400', () => {
    expect(failedRequestEntry({ status: 200, url: 'http://h/?token=x' })).toBeNull()
    expect(failedRequestEntry({ status: 301, url: 'http://h/' })).toBeNull()
  })
  it('records non-api failures with the full masked url', () => {
    expect(failedRequestEntry({ status: 404, url: 'http://h/img.png?token=secret' }))
      .toBe('HTTP 404 http://h/img.png?token=***')
  })
  it('slices api urls to 120 chars after masking', () => {
    const longApi = `http://h/api/${'x'.repeat(200)}?token=secret`
    const entry = failedRequestEntry({ status: 500, url: longApi })
    expect(entry).toBe(`HTTP 500 ${maskToken(longApi).slice(0, 120)}`)
    expect(entry.length).toBe('HTTP 500 '.length + 120)
  })
  it('never leaks the token value in api entries', () => {
    const entry = failedRequestEntry({ status: 500, url: 'http://h/api/x?token=verysecretvalue' })
    expect(entry).not.toContain('verysecretvalue')
  })
})
