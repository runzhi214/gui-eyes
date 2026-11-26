import { describe, it, expect } from 'vitest'
import { runAsserts, runAssertEntry } from '../src/core/asserts.js'

// fake page: locator(sel, opts) 按预置元素表匹配；body 单独处理
const makePage = ({ body = '', elements = [] }) => ({
  locator(sel, opts = {}) {
    if (sel === 'body') return { async innerText() { return body } }
    const matched = elements.filter((e) => e.selector === sel
      && (opts.hasText === undefined || (e.text ?? '').includes(opts.hasText)))
    const makeLoc = (list) => ({
      first: () => makeLoc(list.slice(0, 1)),
      nth: (i) => makeLoc([list[i]].filter(Boolean)),
      async count() { return list.length },
      async innerText() { if (list.length === 0) throw new Error('locator.innerTimeout: 5000ms exceeded'); return list[0]?.text ?? '' },
      async getAttribute(name) { return list[0]?.attrs?.[name] ?? null },
      async isChecked() { return list[0]?.checked ?? false },
    })
    return makeLoc(matched)
  },
})

describe('assert engine: textVisible / textNotVisible', () => {
  it('positive and negative cases', async () => {
    const page = makePage({ body: '资源总数 关注服务 96' })
    const [a, b] = await runAsserts(page, [{ textVisible: '关注服务' }, { textVisible: '不存在' }])
    expect(a).toEqual({ rule: 'textVisible "关注服务"', ok: true, detail: '命中' })
    expect(b.ok).toBe(false)
  })
  it('textNotVisible passes only when the text is absent', async () => {
    const page = makePage({ body: '保存 取消' })
    const [a, b] = await runAsserts(page, [{ textNotVisible: '关闭' }, { textNotVisible: '保存' }])
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(false)
  })
})

describe('assert engine: attrMatches', () => {
  const page = makePage({ elements: [
    { selector: '[class*=helpMark]', text: '?', attrs: { title: '仅统计关注服务，管理类资源不计入' } },
  ] })
  it('matches the documented regex form', async () => {
    const r = await runAssertEntry(page, { attrMatches: { selector: '[class*=helpMark]', attr: 'title', regex: '管理类|不计入' } })
    expect(r.ok).toBe(true)
    expect(r.detail).toContain('关注服务')
  })
  it('fails on regex mismatch', async () => {
    const r = await runAssertEntry(page, { attrMatches: { selector: '[class*=helpMark]', attr: 'title', regex: '不存在' } })
    expect(r.ok).toBe(false)
  })
  it('fails when the attribute is missing', async () => {
    const r = await runAssertEntry(page, { attrMatches: { selector: '[class*=helpMark]', attr: 'alt', regex: '.' } })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('无 alt 属性')
  })
})

describe('assert engine: count', () => {
  const page = makePage({ elements: [
    { selector: '[class*=modalPanel] button', text: '保存' },
    { selector: '[class*=modalPanel] button', text: '取消' },
    { selector: '[class*=modalPanel] button', text: '关闭' },
  ] })
  it('counts with hasText filter and equals', async () => {
    const r = await runAssertEntry(page, { count: { selector: '[class*=modalPanel] button', hasText: '保存', equals: 1 } })
    expect(r).toEqual({ rule: 'count [class*=modalPanel] button hasText:"保存" equals:1', ok: true, detail: '期望 1, 实际 1' })
  })
  it('zero-match proves absence (无「关闭」)', async () => {
    const r = await runAssertEntry(page, { count: { selector: '[class*=modalPanel] button', hasText: '关闭', equals: 0 } })
    expect(r.ok).toBe(false)
    expect(r.detail).toBe('期望 0, 实际 1')
    const absent = await runAssertEntry(page, { count: { selector: '[class*=modalPanel] button', hasText: '不存在的文案', equals: 0 } })
    expect(absent.ok).toBe(true)
  })
  it('fails when the actual count differs', async () => {
    const r = await runAssertEntry(page, { count: { selector: '[class*=modalPanel] button', equals: 2 } })
    expect(r.ok).toBe(false)
    expect(r.detail).toBe('期望 2, 实际 3')
  })
})

describe('assert engine: textMatches (msflip: 服务 N 项)', () => {
  it('regex on the first matched element', async () => {
    const page = makePage({ elements: [{ selector: 'button:has-text("服务")', text: '服务 12 项' }] })
    const r = await runAssertEntry(page, { textMatches: { selector: 'button:has-text("服务")', regex: '服务\\s+\\d+\\s*项' } })
    expect(r.ok).toBe(true)
  })
  it('fails on mismatch and reports the actual text head', async () => {
    const page = makePage({ elements: [{ selector: 'button:has-text("服务")', text: '全部服务' }] })
    const r = await runAssertEntry(page, { textMatches: { selector: 'button:has-text("服务")', regex: '服务\\s+\\d+\\s*项' } })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('全部服务')
  })
  it('fails when no element matches', async () => {
    const r = await runAssertEntry(makePage({ elements: [] }), { textMatches: { selector: 'button', regex: '.' } })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('无匹配元素')
  })
})

describe('assert engine: checked (msflip: 默认全勾)', () => {
  it('all:true passes only when every box is checked and count > 0', async () => {
    const allOn = makePage({ elements: [
      { selector: 'input[type=checkbox]', checked: true },
      { selector: 'input[type=checkbox]', checked: true },
    ] })
    const mixed = makePage({ elements: [
      { selector: 'input[type=checkbox]', checked: true },
      { selector: 'input[type=checkbox]', checked: false },
    ] })
    const empty = makePage({ elements: [] })
    expect((await runAssertEntry(allOn, { checked: { selector: 'input[type=checkbox]', all: true } })).ok).toBe(true)
    const r = await runAssertEntry(mixed, { checked: { selector: 'input[type=checkbox]', all: true } })
    expect(r.ok).toBe(false)
    expect(r.detail).toBe('1/2 勾选')
    expect((await runAssertEntry(empty, { checked: { selector: 'input[type=checkbox]', all: true } })).ok).toBe(false)
  })
})

describe('assert engine: failure containment', () => {
  it('keeps running after a throwing rule and records the exception', async () => {
    const page = { locator: () => { throw new Error('boom') } }
    const results = await runAsserts(page, [{ textVisible: 'a' }, { textVisible: 'b' }])
    expect(results).toHaveLength(2)
    expect(results[0]).toEqual({ rule: 'textVisible "a"', ok: false, detail: '执行异常: boom' })
    expect(results[1].ok).toBe(false)
  })
  it('count with an invalid selector reports 执行异常, never a fake-green equals:0 (issue #1)', async () => {
    const page = { locator: () => { throw new Error('Unexpected token "[")') } }
    const r = await runAssertEntry(page, { count: { selector: 'bad[', equals: 0 } })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('执行异常')
  })
  it('textNotVisible fails (执行异常) when the body is unreadable, never vacuously passes (issue #1)', async () => {
    const page = { locator: () => ({ async innerText() { throw new Error('Target closed') } }) }
    const r = await runAssertEntry(page, { textNotVisible: '错误提示' })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('执行异常')
  })
  it('checked reports 执行异常 when counting throws, instead of "0/0 勾选" lies', async () => {
    const page = { locator: () => { throw new Error('page closed') } }
    const r = await runAssertEntry(page, { checked: { selector: 'input[type=checkbox]', all: true } })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('执行异常')
  })
})
