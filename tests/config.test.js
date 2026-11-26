import { describe, it, expect } from 'vitest'
import { resolveBaseUrl, DEFAULT_BASE_URL, TARGETS, profileDir, httpCredentialsFromEnv, launchOptionsFromEnv } from '../src/core/config.js'
import { UsageError } from '../src/core/usage.js'

describe('resolveBaseUrl (2026-11-26 issue#11 修订链: 显式 > 内联声明 > env > 默认)', () => {
  it('explicit argument wins over everything', () => {
    expect(resolveBaseUrl({ explicit: 'http://a/', env: { GUI_EYES_BASE_URL: 'http://b/' }, inlineDeclared: 'http://c/' }))
      .toBe('http://a/')
  })
  it('inline declaration beats the env variable (issue #11: 场景声明不被 ambient env 劫持)', () => {
    expect(resolveBaseUrl({ env: { GUI_EYES_BASE_URL: 'http://b/' }, inlineDeclared: 'http://c/' })).toBe('http://c/')
  })
  it('env still redirects when nothing is declared', () => {
    expect(resolveBaseUrl({ env: { GUI_EYES_BASE_URL: 'http://b/' } })).toBe('http://b/')
  })
  it('falls back to the provided registry/default', () => {
    expect(resolveBaseUrl({})).toBe(DEFAULT_BASE_URL)
    expect(resolveBaseUrl({ env: {}, fallback: 'http://reg/' })).toBe('http://reg/')
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

describe('profileDir split by auth (issue #11)', () => {
  it('dsh-cookie keeps the shared profile; plain gets its own', () => {
    expect(profileDir('dsh-cookie')).toMatch(/dsh-gui-eyes\/profile$/)
    expect(profileDir('none')).toMatch(/dsh-gui-eyes\/profile-plain$/)
  })
})

describe('httpCredentialsFromEnv', () => {
  it('undefined when unset', () => {
    expect(httpCredentialsFromEnv({})).toBeUndefined()
  })
  it('parses user:pass (colon may appear in the password)', () => {
    expect(httpCredentialsFromEnv({ GUI_EYES_HTTP_CREDS: 'u:p:a' })).toEqual({ username: 'u', password: 'p:a' })
  })
  it('rejects malformed values with a structured error', () => {
    for (const bad of ['', 'nocolon', ':pass']) {
      expect(() => httpCredentialsFromEnv({ GUI_EYES_HTTP_CREDS: bad })).toThrow(UsageError)
    }
  })
})

describe('launchOptionsFromEnv (whitelist passthrough)', () => {
  it('empty when unset', () => {
    expect(launchOptionsFromEnv({})).toEqual({})
  })
  it('passes through whitelisted keys only', () => {
    const env = { GUI_EYES_LAUNCH_JSON: '{"ignoreHTTPSErrors":true,"userAgent":"bot","locale":"zh-CN","proxy":{"server":"http://p:1"},"evil":"x"}' }
    expect(launchOptionsFromEnv(env)).toEqual({
      ignoreHTTPSErrors: true, userAgent: 'bot', locale: 'zh-CN', proxy: { server: 'http://p:1' },
    })
  })
  it('rejects invalid json with a structured error', () => {
    expect(() => launchOptionsFromEnv({ GUI_EYES_LAUNCH_JSON: '{oops' })).toThrow(UsageError)
    expect(() => launchOptionsFromEnv({ GUI_EYES_LAUNCH_JSON: '[1]' })).toThrow(UsageError)
  })
})
