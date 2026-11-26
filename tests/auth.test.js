import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isAuthRequired, readTokenUrl, ensureDshCookieAuth, AuthError, NO_TOKEN_HINT, STALE_TOKEN_HINT } from '../src/core/auth.js'

describe('isAuthRequired', () => {
  it('detects the 401 marker text', () => {
    expect(isAuthRequired('dsh web authentication required; reopen the URL printed by dsh web.')).toBe(true)
  })
  it('rejects normal page text and empty input', () => {
    expect(isAuthRequired('some dashboard text')).toBe(false)
    expect(isAuthRequired('')).toBe(false)
  })
})

describe('readTokenUrl', () => {
  let dir
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'gui-eyes-auth-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('returns null when no file exists', () => {
    expect(readTokenUrl([join(dir, 'a'), join(dir, 'b')])).toBeNull()
  })
  it('returns the full url verbatim (no parsing, hash route included)', () => {
    const url = 'http://127.0.0.1:3080/?token=abc#/workbench'
    writeFileSync(join(dir, 'a'), `${url}\n`)
    expect(readTokenUrl([join(dir, 'a')])).toBe(url)
  })
  it('trims surrounding whitespace', () => {
    writeFileSync(join(dir, 'a'), '  http://h/?token=x  \n')
    expect(readTokenUrl([join(dir, 'a')])).toBe('http://h/?token=x')
  })
  it('skips non-url content and falls through to the next file', () => {
    writeFileSync(join(dir, 'a'), 'garbage')
    writeFileSync(join(dir, 'b'), 'http://h/?token=y')
    expect(readTokenUrl([join(dir, 'a'), join(dir, 'b')])).toBe('http://h/?token=y')
  })
  it('prefers the first file in order', () => {
    writeFileSync(join(dir, 'a'), 'http://first/?token=1')
    writeFileSync(join(dir, 'b'), 'http://second/?token=2')
    expect(readTokenUrl([join(dir, 'a'), join(dir, 'b')])).toBe('http://first/?token=1')
  })
})

const fakePage = ({ bodyText, bodySeq = [], gotoImpls = [] }) => {
  const gotoCalls = []
  return {
    gotoCalls,
    async goto(url, opts) {
      gotoCalls.push({ url, opts })
      if (gotoImpls.shift() === 'throw') throw new Error('goto failed')
    },
    locator: () => ({
      // bodySeq: 逐次读取序列;耗尽后回落 bodyText;'throw' 模拟读取失败
      async innerText() {
        const next = bodySeq.length > 0 ? bodySeq.shift() : bodyText
        if (next === 'throw') throw new Error('body unreadable')
        return next
      },
    }),
  }
}

describe('ensureDshCookieAuth', () => {
  const noTokenFiles = ['/nonexistent-a', '/nonexistent-b']

  it('returns cookie mode when the probe shows no auth wall', async () => {
    const page = fakePage({ bodyText: 'dashboard ready' })
    const mode = await ensureDshCookieAuth({ page, baseUrl: 'http://h/', tokenFiles: noTokenFiles })
    expect(mode).toBe('cookie')
    expect(page.gotoCalls).toEqual([{ url: 'http://h/', opts: { waitUntil: 'domcontentloaded', timeout: 20000 } }])
  })

  it('swallows probe goto failures and keeps the cookie verdict', async () => {
    const page = fakePage({ bodyText: '', gotoImpls: ['throw'] })
    await expect(ensureDshCookieAuth({ page, baseUrl: 'http://h/', tokenFiles: noTokenFiles })).resolves.toBe('cookie')
  })

  it('throws NO_TOKEN when the wall shows and no token file exists', async () => {
    const page = fakePage({ bodyText: 'dsh web authentication required' })
    const err = await ensureDshCookieAuth({ page, baseUrl: 'http://h/', tokenFiles: noTokenFiles }).catch(e => e)
    expect(err).toBeInstanceOf(AuthError)
    expect(err.code).toBe('NO_TOKEN')
    expect(err.hint).toBe(NO_TOKEN_HINT)
    expect(page.gotoCalls).toHaveLength(1)
  })

  it('recasts with the token url verbatim and reports token-bootstrap after re-verify', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gui-eyes-tok-'))
    try {
      const tokenUrl = 'http://h:3080/?token=secret#/route'
      writeFileSync(join(dir, 'token'), tokenUrl)
      const page = fakePage({ bodyText: 'authentication required', bodySeq: ['authentication required', '页面已就绪'] })
      const mode = await ensureDshCookieAuth({ page, baseUrl: 'http://h/', tokenFiles: [join(dir, 'token')] })
      expect(mode).toBe('token-bootstrap')
      expect(page.gotoCalls[1]).toEqual({ url: tokenUrl, opts: { waitUntil: 'domcontentloaded', timeout: 20000 } })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('throws TOKEN_STALE when the redemption page still shows the auth wall (issue #3)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gui-eyes-tok-'))
    try {
      writeFileSync(join(dir, 'token'), 'http://h/?token=dead')
      const page = fakePage({
        bodyText: 'authentication required',
        bodySeq: ['dsh web authentication required; reopen the URL printed by dsh web.', 'dsh web authentication required; reopen the URL printed by dsh web.'],
      })
      const err = await ensureDshCookieAuth({ page, baseUrl: 'http://h/', tokenFiles: [join(dir, 'token')] }).catch(e => e)
      expect(err).toBeInstanceOf(AuthError)
      expect(err.code).toBe('TOKEN_STALE')
      expect(err.hint).toBe(STALE_TOKEN_HINT)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('re-verify read failure degrades to token-bootstrap (page health is reported by gui_open degraded)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gui-eyes-tok-'))
    try {
      writeFileSync(join(dir, 'token'), 'http://h/?token=x')
      const page = fakePage({ bodyText: '', bodySeq: ['authentication required', 'throw'] })
      const mode = await ensureDshCookieAuth({ page, baseUrl: 'http://h/', tokenFiles: [join(dir, 'token')] })
      expect(mode).toBe('token-bootstrap')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('propagates recast goto failures (no swallow)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gui-eyes-tok-'))
    try {
      writeFileSync(join(dir, 'token'), 'http://h/?token=x')
      const page = fakePage({ bodyText: 'authentication required', gotoImpls: ['throw', 'throw'] })
      await expect(ensureDshCookieAuth({ page, baseUrl: 'http://h/', tokenFiles: [join(dir, 'token')] }))
        .rejects.toThrow('goto failed')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
