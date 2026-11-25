const DETAIL_SLICE = 80
const RULE_SLICE = 40

const clip = (s, n) => String(s).slice(0, n)
const bySelector = (sel) => clip(sel, RULE_SLICE)

async function bodyText(page) {
  return page.locator('body').innerText().catch(() => '')
}

const ASSERT_ENGINES = {
  async textVisible(page, text) {
    const body = await bodyText(page)
    return { ok: body.includes(text), detail: body.includes(text) ? '命中' : `未命中: 页面无文本 "${text}"` }
  },
  async textNotVisible(page, text) {
    const body = await bodyText(page)
    return { ok: !body.includes(text), detail: body.includes(text) ? `未通过: 页面仍有文本 "${text}"` : '未出现' }
  },
  async attrMatches(page, { selector, attr, regex }) {
    const value = await page.locator(selector).first().getAttribute(attr).catch(() => null)
    if (value === null) return { ok: false, detail: `未通过: ${bySelector(selector)} 无 ${attr} 属性` }
    const re = new RegExp(regex)
    return re.test(value)
      ? { ok: true, detail: clip(value, DETAIL_SLICE) }
      : { ok: false, detail: `不匹配: ${clip(value, DETAIL_SLICE)}` }
  },
  async count(page, { selector, hasText, equals }) {
    const locator = page.locator(selector, hasText !== undefined ? { hasText } : {})
    const actual = await locator.count().catch(() => 0)
    return { ok: actual === equals, detail: `期望 ${equals}, 实际 ${actual}` }
  },
  async textMatches(page, { selector, regex }) {
    const text = await page.locator(selector).first().innerText().catch(() => null)
    if (text === null) return { ok: false, detail: `未通过: ${bySelector(selector)} 无匹配元素` }
    const re = new RegExp(regex)
    return { ok: re.test(text), detail: re.test(text) ? clip(text, DETAIL_SLICE) : `不匹配: "${clip(text, DETAIL_SLICE)}"` }
  },
  async checked(page, { selector, all }) {
    const boxes = page.locator(selector)
    const total = await boxes.count().catch(() => 0)
    if (total === 0) return { ok: false, detail: '未通过: 无匹配元素' }
    const states = await Promise.all(Array.from({ length: total }, (_, i) => boxes.nth(i).isChecked().catch(() => false)))
    const on = states.filter(Boolean).length
    return { ok: all && on === total, detail: `${on}/${total} 勾选` }
  },
}

function ruleLabel(rule, arg) {
  if (typeof arg === 'string') return `${rule} "${arg}"`
  if (rule === 'attrMatches') return `${rule} ${bySelector(arg.selector)} @${arg.attr}`
  if (rule === 'count') return `count ${bySelector(arg.selector)}${arg.hasText !== undefined ? ` hasText:"${arg.hasText}"` : ''} equals:${arg.equals}`
  if (rule === 'textMatches') return `${rule} ${bySelector(arg.selector)}`
  if (rule === 'checked') return `${rule} ${bySelector(arg.selector)}`
  return rule
}

export async function runAssertEntry(page, entry) {
  const [rule] = Object.keys(entry)
  const arg = entry[rule]
  const label = ruleLabel(rule, arg)
  try {
    const { ok, detail } = await ASSERT_ENGINES[rule](page, arg)
    return { rule: label, ok, detail }
  } catch (e) {
    return { rule: label, ok: false, detail: `执行异常: ${e.message}` }
  }
}

export async function runAsserts(page, entries) {
  const results = []
  for (const entry of entries) results.push(await runAssertEntry(page, entry))
  return results
}
