import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveTarget } from '../src/core/session.js'
import { runStep } from '../src/core/primitives.js'
import { runScenario } from '../src/scenario/runner.js'

// fake page: 记录原语调用,可编程响应
const makePage = ({ body = '', failOn = null } = {}) => {
  const calls = []
  const page = {
    calls,
    async goto(url, opts) { calls.push(['goto', url, opts]); if (failOn === 'goto') throw new Error('goto boom') },
    async waitForTimeout(ms) { calls.push(['wait', ms]) },
    async screenshot({ path }) { calls.push(['shot', path]); if (failOn === 'shot') throw new Error('shot boom') },
    locator(sel) {
      if (sel === 'body') return { async innerText() { calls.push(['bodyText']); return body } }
      const loc = {
        async click(opts) { calls.push(['click', sel, opts]); if (failOn === 'click') throw new Error('click boom') },
        async fill(text, opts) { calls.push(['fill', sel, text, opts]) },
      }
      return { first: () => loc, ...loc }
    },
    getByText(text, opts) { calls.push(['getByText', text, opts]); return this.locator(`text:${text}`) },
    getByRole(role, opts) { calls.push(['getByRole', role, opts]); return this.locator(`role:${role}`) },
  }
  return page
}

describe('resolveTarget', () => {
  it('dsh-web default carries the 3080 baseUrl and dsh-cookie auth', () => {
    expect(resolveTarget({})).toEqual({ baseUrl: 'http://127.0.0.1:3080/', auth: 'dsh-cookie' })
  })
  it('plain target falls back through the priority chain with auth none', () => {
    expect(resolveTarget({ target: 'plain', explicitBaseUrl: 'http://h/' })).toEqual({ baseUrl: 'http://h/', auth: 'none' })
    expect(resolveTarget({ target: 'plain' })).toEqual({ baseUrl: 'http://127.0.0.1:3080/', auth: 'none' })
  })
  it('inline target wins as declared unless overridden explicitly', () => {
    expect(resolveTarget({ target: { baseUrl: 'http://t/', auth: 'none' } })).toEqual({ baseUrl: 'http://t/', auth: 'none' })
    expect(resolveTarget({ target: { baseUrl: 'http://t/', auth: 'none' }, explicitBaseUrl: 'http://x/' }))
      .toEqual({ baseUrl: 'http://x/', auth: 'none' })
  })
})

describe('runStep primitives', () => {
  const ctx = () => ({ baseUrl: 'http://h:3080/', outDir: '.', timeoutScale: 1, shots: [], bodyText: null })

  it('goto resolves relative paths against baseUrl and absolute urls verbatim', async () => {
    const page = makePage()
    await runStep(page, { goto: '/' }, ctx())
    await runStep(page, { goto: '/workbench' }, ctx())
    await runStep(page, { goto: 'http://other:9/x' }, ctx())
    expect(page.calls.map(c => c[1])).toEqual([
      'http://h:3080/', 'http://h:3080/workbench', 'http://other:9/x',
    ])
  })
  it('wait applies the timeout scale', async () => {
    const page = makePage()
    await runStep(page, { wait: 6000 }, { ...ctx(), timeoutScale: 2 })
    expect(page.calls[0]).toEqual(['wait', 12000])
  })
  it('click builds locators for text, role and selector specs', async () => {
    const page = makePage()
    await runStep(page, { click: { text: '资源管理', exact: true } }, ctx())
    await runStep(page, { click: { role: 'button', name: '配置项' } }, ctx())
    await runStep(page, { click: { selector: '[class*=rankRow]' } }, ctx())
    await runStep(page, { click: '裸文本' }, ctx())
    expect(page.calls.filter(c => c[0] === 'getByText')[0][2]).toEqual({ exact: true })
    expect(page.calls.filter(c => c[0] === 'getByRole')[0]).toEqual(['getByRole', 'button', { name: '配置项' }])
    expect(page.calls.filter(c => c[0] === 'click')).toHaveLength(4)
  })
  it('click ifNotVisible skips when the text is already on the page', async () => {
    const page = makePage({ body: '资源明细 已在场' })
    await runStep(page, { click: { selector: '[class*=rankRow]', ifNotVisible: '资源明细' } }, ctx())
    expect(page.calls.filter(c => c[0] === 'click')).toHaveLength(0)
    const page2 = makePage({ body: '别的' })
    await runStep(page2, { click: { selector: '[class*=rankRow]', ifNotVisible: '资源明细' } }, ctx())
    expect(page2.calls.filter(c => c[0] === 'click')).toHaveLength(1)
  })
  it('shot writes a timestamped file under outDir and records the path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gui-eyes-shot-'))
    try {
      const page = makePage()
      const c = { ...ctx(), outDir: dir }
      await runStep(page, { shot: 'root' }, c)
      const [action, path] = page.calls[0]
      expect(action).toBe('shot')
      expect(path.startsWith(join(dir, 'root-'))).toBe(true)
      expect(path.endsWith('.png')).toBe(true)
      expect(c.shots).toEqual([path])
      expect(existsSync(path)).toBe(false) // fake 不真写盘; 真写盘由活体回归覆盖
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('dom captures body text into ctx', async () => {
    const page = makePage({ body: '正文内容' })
    const c = ctx()
    await runStep(page, { dom: {} }, c)
    expect(c.bodyText).toBe('正文内容')
  })
})

describe('runScenario', () => {
  const fakeCtx = () => ({ baseUrl: 'http://h/', outDir: '.', timeoutScale: 1, shots: [], bodyText: null })

  it('executes steps in order, records failures and keeps going (catch-continue)', async () => {
    const page = makePage({ failOn: 'click' })
    const scenario = { name: 't', target: 'dsh-web', steps: [{ wait: 10 }, { click: { text: '不存在' } }, { wait: 20 }], asserts: [] }
    const { steps } = await runScenario(page, scenario, fakeCtx())
    expect(steps).toEqual([
      { action: 'wait', arg: 10, ok: true },
      { action: 'click', arg: { text: '不存在' }, ok: false },
      { action: 'wait', arg: 20, ok: true },
    ])
  })
  it('inline asserts interleave with steps and land in asserts, not steps', async () => {
    const page = makePage({ body: '资源明细' })
    const scenario = {
      name: 't', target: 'dsh-web',
      steps: [{ wait: 10 }, { assert: { textVisible: '资源明细' } }, { wait: 20 }],
      asserts: [{ textNotVisible: '关闭' }],
    }
    const { steps, asserts } = await runScenario(page, scenario, fakeCtx())
    expect(steps.map(s => s.action)).toEqual(['wait', 'wait'])
    expect(asserts.map(a => a.ok)).toEqual([true, true])
  })
  it('post asserts run after inline asserts; body text captured once at the end when no dom step', async () => {
    const page = makePage({ body: '最终正文' })
    const scenario = { name: 't', target: 'dsh-web', steps: [{ wait: 1 }], asserts: [{ textVisible: '最终正文' }] }
    const c = fakeCtx()
    const { asserts } = await runScenario(page, scenario, c)
    expect(asserts[0].ok).toBe(true)
    expect(c.bodyText).toBe('最终正文')
    expect(page.calls.filter(x => x[0] === 'bodyText')).toHaveLength(2) // assert 采 1 次 + 结尾采 1 次
  })
})
