import { describe, it, expect } from 'vitest'
import { runAsserts, runAssertEntry } from '../src/core/asserts.js'

// fake page: 双引擎定位器——body.innerText(主文档全文)与 getByText(click 同口径: 命中可见文本元素)
// elements 表驱动: { selector, text, visible, attrs, checked };frame 定位经 frameLocator(sel) 子树
const makePage = ({ body = '', elements = [], frames = [] } = {}) => {
  const visibleTexts = () => elements.filter(e => e.visible !== false)
  const page = {
    locator(sel, opts = {}) {
      if (sel === 'body') return { async innerText() { return body } }
      const matched = elements.filter((e) => e.selector === sel
        && (opts.hasText === undefined || (e.text ?? '').includes(opts.hasText)))
      const makeLoc = (list) => ({
        first: () => makeLoc(list.slice(0, 1)),
        nth: (i) => makeLoc([list[i]].filter(Boolean)),
        async count() { return list.length },
        async innerText() { if (list.length === 0) throw Object.assign(new Error('locator.innerTimeout: 5000ms exceeded'), { name: 'TimeoutError' }); return list[0]?.text ?? '' },
        async getAttribute(name) { return list[0]?.attrs?.[name] ?? null },
        async isChecked() { return list[0]?.checked ?? false },
      })
      return makeLoc(matched)
    },
    getByText(text) {
      // click 同口径: 可见元素的文本子串匹配(shadow 穿透语义由调用方用 shadowTexts 模拟)
      const matched = [...visibleTexts(), ...(page.shadowTexts ?? [])].filter(e => (e.text ?? '').includes(text))
      const makeLoc = (list) => ({
        filter: ({ visible }) => makeLoc(visible === true ? list.filter(e => e.visible !== false) : list),
        async count() { return list.length },
        first: () => makeLoc(list.slice(0, 1)),
        nth: (i) => makeLoc([list[i]].filter(Boolean)),
        innerText: async () => { if (list.length === 0) throw Object.assign(new Error('innerTimeout'), { name: 'TimeoutError' }); return list[0].text },
        click: async () => {},
      })
      return makeLoc(matched)
    },
    frameLocator(sel) {
      const sub = frames.find(f => f.selector === sel)
      const subPage = sub ? makePage({ elements: sub.elements }) : makePage({ elements: [] })
      return subPage
    },
  }
  return page
}

describe('assert engine: textVisible / textNotVisible (click 同口径, issue #9)', () => {
  it('positive and negative cases', async () => {
    const page = makePage({ elements: [{ selector: 'h1', text: '资源总数 关注服务 96', visible: true }] })
    const [a, b] = await runAsserts(page, [{ textVisible: '关注服务' }, { textVisible: '不存在' }])
    expect(a).toEqual({ rule: 'textVisible "关注服务"', ok: true, detail: '命中' })
    expect(b.ok).toBe(false)
  })
  it('hidden elements do not count (innerText 旧口径的误命中已修复)', async () => {
    const page = makePage({ elements: [{ selector: 'p', text: '隐藏提示', visible: false }] })
    const r = await runAssertEntry(page, { textVisible: '隐藏提示' })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('未命中')
  })
  it('shadow text is visible to the assertion engine (穿透 open shadow)', async () => {
    const page = makePage({ elements: [], body: '' })
    page.shadowTexts = [{ text: 'SHADOW_TEXT_MARKER', visible: true }]
    const r = await runAssertEntry(page, { textVisible: 'SHADOW_TEXT_MARKER' })
    expect(r.ok).toBe(true)
  })
  it('textNotVisible passes only when the text is absent', async () => {
    const page = makePage({ elements: [{ selector: 'p', text: '保存 取消', visible: true }] })
    const [a, b] = await runAsserts(page, [{ textNotVisible: '关闭' }, { textNotVisible: '保存' }])
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(false)
  })
  it('object form {text, frame} asserts text inside an iframe (issue #9)', async () => {
    const page = makePage({
      elements: [{ selector: 'h1', text: 'MAIN_MARKER', visible: true }],
      frames: [{ selector: 'iframe#frame1', elements: [{ selector: 'p', text: 'IFRAME_TEXT_MARKER', visible: true }] }],
    })
    const [a, b, c] = await runAsserts(page, [
      { textVisible: { text: 'IFRAME_TEXT_MARKER', frame: 'iframe#frame1' } },
      { textVisible: 'IFRAME_TEXT_MARKER' },
      { textVisible: 'MAIN_MARKER' },
    ])
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(false)
    expect(c.ok).toBe(true)
  })
})

describe('assert engine: attrMatches', () => {
  const page = makePage({ elements: [
    { selector: '[class*=helpMark]', text: '?', visible: true, attrs: { title: '仅统计关注服务，管理类资源不计入' } },
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
    { selector: '[class*=modalPanel] button', text: '保存', visible: true },
    { selector: '[class*=modalPanel] button', text: '取消', visible: true },
    { selector: '[class*=modalPanel] button', text: '关闭', visible: true },
  ] })
  it('counts with hasText filter and equals', async () => {
    const r = await runAssertEntry(page, { count: { selector: '[class*=modalPanel] button', hasText: '保存', equals: 1 } })
    expect(r).toEqual({ rule: 'count [class*=modalPanel] button hasText:"保存" equals:1', ok: true, detail: '期望 1, 实际 1' })
  })
  it('zero-match proves absence', async () => {
    const r = await runAssertEntry(page, { count: { selector: '[class*=modalPanel] button', hasText: '关闭', equals: 0 } })
    expect(r.ok).toBe(false)
    expect(r.detail).toBe('期望 0, 实际 1')
    const absent = await runAssertEntry(page, { count: { selector: '[class*=modalPanel] button', hasText: '不存在的文案', equals: 0 } })
    expect(absent.ok).toBe(true)
  })
  it('counts inside an iframe via frame (issue #9)', async () => {
    const page2 = makePage({ frames: [{ selector: '#frame1', elements: [{ selector: 'p', text: 'x', visible: true }, { selector: 'p', text: 'y', visible: true }] }] })
    const r = await runAssertEntry(page2, { count: { selector: 'p', equals: 2, frame: '#frame1' } })
    expect(r.ok).toBe(true)
  })
})

describe('assert engine: textMatches', () => {
  it('regex on the first matched element', async () => {
    const page = makePage({ elements: [{ selector: 'button:has-text("服务")', text: '服务 12 项', visible: true }] })
    const r = await runAssertEntry(page, { textMatches: { selector: 'button:has-text("服务")', regex: '服务\\s+\\d+\\s*项' } })
    expect(r.ok).toBe(true)
  })
  it('fails on mismatch and reports the actual text head', async () => {
    const page = makePage({ elements: [{ selector: 'button:has-text("服务")', text: '全部服务', visible: true }] })
    const r = await runAssertEntry(page, { textMatches: { selector: 'button:has-text("服务")', regex: '服务\\s+\\d+\\s*项' } })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('全部服务')
  })
  it('fails with 无匹配元素 when nothing matches (semantic miss, not 执行异常)', async () => {
    const r = await runAssertEntry(makePage({ elements: [] }), { textMatches: { selector: 'button', regex: '.' } })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('无匹配元素')
  })
})

describe('assert engine: checked', () => {
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
    const page = { locator: () => { throw new Error('boom') }, getByText: () => { throw new Error('boom') } }
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
  it('textNotVisible fails (执行异常) when the engine throws, never vacuously passes (issue #1)', async () => {
    const page = { locator: () => { throw new Error('boom') }, getByText: () => { throw new Error('boom') } }
    const r = await runAssertEntry(page, { textNotVisible: '错误提示' })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('执行异常')
  })
  it('checked reports 执行异常 when counting throws', async () => {
    const page = { locator: () => { throw new Error('page closed') } }
    const r = await runAssertEntry(page, { checked: { selector: 'input[type=checkbox]', all: true } })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('执行异常')
  })
})
