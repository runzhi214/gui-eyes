import { describe, it, expect } from 'vitest'
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
