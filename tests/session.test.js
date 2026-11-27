import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openSession } from '../src/core/session.js'
import { UsageError, PLAIN_BASE_URL_HINT } from '../src/core/usage.js'

describe('openSession: plain baseUrl guard (issue #6)', () => {
  it('throws PLAIN_BASE_URL_MISSING before launching when plain has no explicit baseUrl', async () => {
    const launch = () => { throw new Error('launch must not be called') }
    const err = await openSession({ target: 'plain', env: {}, launch }).catch(e => e)
    expect(err).toBeInstanceOf(UsageError)
    expect(err.code).toBe('PLAIN_BASE_URL_MISSING')
    expect(err.hint).toBe(PLAIN_BASE_URL_HINT)
  })
  it('accepts plain when the baseUrl comes from the env variable', async () => {
    // 守卫先于 launch;env 提供 baseUrl 即通过守卫,launch 注入假实现避免真启浏览器
    const err = await openSession({
      target: 'plain',
      env: { GUI_EYES_BASE_URL: 'http://h/' },
      launch: () => { throw new Error('guard must pass before launch; this fake launch is only reached when the guard fails') },
    }).catch(e => e)
    // 守卫通过后流程进入 launch(假实现抛错),证明守卫未拦截
    expect(err).not.toBeInstanceOf(UsageError)
  })
})

// fake 启动全家桶: context 记录 addCookies/addInitScript, page 只需 on/goto
const makePlainFakes = () => {
  const calls = { addCookies: [], addInitScript: 0, goto: [] }
  const page = { on() {}, goto: async (url, opts) => { calls.goto.push([url, opts]) } }
  const context = {
    pages: () => [page],
    newPage: async () => page,
    addCookies: async (cookies) => { calls.addCookies.push(cookies) },
    addInitScript: async () => { calls.addInitScript += 1 },
  }
  return { context, calls }
}

describe('openSession: storageState 导入 (#25, 仅 plain 通道)', () => {
  it('cookies 经 addCookies 注入、origins 经 addInitScript 水合,且都先于首跳导航', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gui-eyes-ss-'))
    try {
      const statePath = join(dir, 'state.json')
      writeFileSync(statePath, JSON.stringify({
        cookies: [{ name: 'sid', value: 'v', url: 'http://h/' }],
        origins: [{ origin: 'http://h', localStorage: [{ name: 'k', value: 'V' }] }],
      }))
      const fakes = makePlainFakes()
      await openSession({
        target: 'plain',
        env: { GUI_EYES_BASE_URL: 'http://h/', GUI_EYES_STORAGE_STATE: statePath },
        launch: async () => fakes.context,
      })
      expect(fakes.calls.addCookies).toEqual([[{ name: 'sid', value: 'v', url: 'http://h/' }]])
      expect(fakes.calls.addInitScript).toBe(1)
      expect(fakes.calls.goto).toHaveLength(1)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('未设 env 时零注入,行为与现状一致', async () => {
    const fakes = makePlainFakes()
    await openSession({
      target: 'plain',
      env: { GUI_EYES_BASE_URL: 'http://h/' },
      launch: async () => fakes.context,
    })
    expect(fakes.calls.addCookies).toEqual([])
    expect(fakes.calls.addInitScript).toBe(0)
  })
  it('文件不存在时报 BAD_STORAGE_STATE,不静默裸奔', async () => {
    const fakes = makePlainFakes()
    const err = await openSession({
      target: 'plain',
      env: { GUI_EYES_BASE_URL: 'http://h/', GUI_EYES_STORAGE_STATE: '/no/such/state.json' },
      launch: async () => fakes.context,
    }).catch(e => e)
    expect(err).toBeInstanceOf(UsageError)
    expect(err.code).toBe('BAD_STORAGE_STATE')
    expect(fakes.calls.goto).toEqual([]) // 注入失败先于导航,不起无鉴权会话
  })
})
