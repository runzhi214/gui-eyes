import { describe, it, expect } from 'vitest'
import { resolveBaseUrl, DEFAULT_BASE_URL, TARGETS } from '../src/core/config.js'

describe('resolveBaseUrl (§4.1 priority chain)', () => {
  it('explicit argument wins over everything', () => {
    expect(resolveBaseUrl({ explicit: 'http://a/', env: { GUI_EYES_BASE_URL: 'http://b/' }, targetDeclared: 'http://c/' }))
      .toBe('http://a/')
  })
  it('GUI_EYES_BASE_URL beats the scenario declaration', () => {
    expect(resolveBaseUrl({ env: { GUI_EYES_BASE_URL: 'http://b/' }, targetDeclared: 'http://c/' })).toBe('http://b/')
  })
  it('scenario declaration beats the default', () => {
    expect(resolveBaseUrl({ targetDeclared: 'http://c/' })).toBe('http://c/')
  })
  it('falls back to the documented default', () => {
    expect(resolveBaseUrl({})).toBe(DEFAULT_BASE_URL)
    expect(resolveBaseUrl({ env: {} })).toBe(DEFAULT_BASE_URL)
  })
})

describe('target registry (D10)', () => {
  it('dsh-web defaults to 3080 with dsh-cookie auth', () => {
    expect(TARGETS['dsh-web']).toEqual({ baseUrl: DEFAULT_BASE_URL, auth: 'dsh-cookie' })
  })
  it('plain carries no auth', () => {
    expect(TARGETS.plain).toEqual({ auth: 'none' })
  })
})
