import { locateAll } from './primitives.js'

const DETAIL_SLICE = 80
const RULE_SLICE = 40
const MESSAGE_SLICE = 120

const clip = (s, n) => String(s).slice(0, n)
const bySelector = (sel) => clip(sel, RULE_SLICE)
const clipMessage = (e) => clip(e?.message ?? e, MESSAGE_SLICE)

// frame 根定位(issue #9): rule.frame 存在时经由 frameLocator 进入 iframe
const rootIn = (page, frame) => (frame === undefined ? page : page.frameLocator(frame))

// 可见文本判定与 click 同源(issue #9): getByText 穿透 open shadow、filter({visible:true}) 只计可见元素、
// 子串大小写不敏感(= click 的 text 默认语义)——「点得中」与「断言得到」口径一致。
// 旧 innerText 引擎对 shadow 文本不可见、对隐藏元素误命中,已废弃;跨元素边界的文本两侧同样匹配不到(口径一致)。
async function visibleTextCount(page, text, frame) {
  return locateAll(rootIn(page, frame), text).filter({ visible: true }).count()
}

const ASSERT_ENGINES = {
  async textVisible(page, arg) {
    const { text, frame } = typeof arg === 'string' ? { text: arg, frame: undefined } : arg
    const n = await visibleTextCount(page, text, frame)
    return { ok: n > 0, detail: n > 0 ? '命中' : `未命中: 页面无可见文本 "${text}"` }
  },
  async textNotVisible(page, arg) {
    const { text, frame } = typeof arg === 'string' ? { text: arg, frame: undefined } : arg
    const n = await visibleTextCount(page, text, frame)
    return { ok: n === 0, detail: n === 0 ? '未出现' : `未通过: 页面仍有可见文本 "${text}"` }
  },
  async attrMatches(page, { selector, attr, regex, frame }) {
    const value = await rootIn(page, frame).locator(selector).first().getAttribute(attr)
    if (value === null) return { ok: false, detail: `未通过: ${bySelector(selector)} 无 ${attr} 属性` }
    const re = new RegExp(regex)
    return re.test(value)
      ? { ok: true, detail: clip(value, DETAIL_SLICE) }
      : { ok: false, detail: `不匹配: ${clip(value, DETAIL_SLICE)}` }
  },
  async count(page, { selector, hasText, equals, frame }) {
    const locator = rootIn(page, frame).locator(selector, hasText !== undefined ? { hasText } : {})
    const actual = await locator.count()
    return { ok: actual === equals, detail: `期望 ${equals}, 实际 ${actual}` }
  },
  async textMatches(page, { selector, regex, frame }) {
    let text
    try {
      text = await rootIn(page, frame).locator(selector).first().innerText()
    } catch (e) {
      // TimeoutError = 无匹配元素(语义性缺失);其它错误向上抛记「执行异常」
      if (e?.name === 'TimeoutError') return { ok: false, detail: `未通过: ${bySelector(selector)} 无匹配元素` }
      throw e
    }
    const re = new RegExp(regex)
    return re.test(text)
      ? { ok: true, detail: clip(text, DETAIL_SLICE) }
      : { ok: false, detail: `不匹配: "${clip(text, DETAIL_SLICE)}"` }
  },
  async checked(page, { selector, all, frame }) {
    const boxes = rootIn(page, frame).locator(selector)
    const total = await boxes.count()
    if (total === 0) return { ok: false, detail: '未通过: 无匹配元素' }
    const states = await Promise.all(Array.from({ length: total }, (_, i) => boxes.nth(i).isChecked()))
    const on = states.filter(Boolean).length
    return { ok: all && on === total, detail: `${on}/${total} 勾选` }
  },
}

function ruleLabel(rule, arg) {
  if (typeof arg === 'string') return `${rule} "${arg}"`
  const frame = arg.frame !== undefined ? ` @frame:${bySelector(arg.frame)}` : ''
  if (rule === 'attrMatches') return `${rule} ${bySelector(arg.selector)} @${arg.attr}${frame}`
  if (rule === 'count') return `count ${bySelector(arg.selector)}${arg.hasText !== undefined ? ` hasText:"${arg.hasText}"` : ''}${frame} equals:${arg.equals}`
  if (rule === 'textMatches') return `${rule} ${bySelector(arg.selector)}${frame}`
  if (rule === 'checked') return `${rule} ${bySelector(arg.selector)}${frame}`
  if (rule === 'textVisible' || rule === 'textNotVisible') return `${rule} "${arg.text}"${frame}`
  return rule
}

export async function runAssertEntry(page, entry) {
  const [rule] = Object.keys(entry)
  const arg = entry[rule]
  // 未知规则名: 报期望的规则清单,不伪装成引擎损坏(issue #15)
  if (ASSERT_ENGINES[rule] === undefined) {
    return { rule: String(rule).slice(0, RULE_SLICE), ok: false, detail: `未知断言规则 "${rule}"——键名必须直接是规则名(单键对象,如 {"textVisible": "文本"});可用: ${Object.keys(ASSERT_ENGINES).join(' | ')}` }
  }
  const label = ruleLabel(rule, arg)
  try {
    const { ok, detail } = await ASSERT_ENGINES[rule](page, arg)
    return { rule: label, ok, detail }
  } catch (e) {
    return { rule: label, ok: false, detail: `执行异常: ${clipMessage(e)}` }
  }
}

export async function runAsserts(page, entries) {
  const results = []
  for (const entry of entries) results.push(await runAssertEntry(page, entry))
  return results
}
