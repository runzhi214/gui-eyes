// 编号寻址 + delta 快照的纯逻辑核心(接口设计见 docs/design-inventory-delta.md)
// 引擎形态: 无常驻 content script,编号按结构稳定性(指纹)而非元素生命周期——
// 同 DOM 两次快照同元素同编号;元素消失编号收敛不错位;新增元素插入不挤占既有编号。

export const INVENTORY_MAX = 30
export const ITEM_TEXT_SLICE = 80
const DSH_EL_ATTRIBUTE = 'data-dsh-el'

// dsh-browser 同款交互元素集(可见性过滤在 browser 侧做)
const INTERACTIVE_SELECTOR = [
  'a[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea',
  '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
  '[role="tab"]', '[role="menuitem"]', 'summary',
  '[contenteditable="true"]', '[contenteditable=""]',
].join(', ')

// 结构指纹: 同页两次快照同元素同 key。tagName + 可见文本摘要 + 同签名序号;
// text 用摘要(前 40 字符)而非全文,避免长文本尾部变化导致错号。
export function stableKey(tagName, text, sameSignatureIndex) {
  return `${tagName}|${String(text).slice(0, 40)}|${sameSignatureIndex}`
}

// page 侧收集: 由 tools 注入的 evaluate 实现(此处只定形态与纯逻辑):
// collectInteractive(page) → [{ tagName, text, attrs }] (browser 侧可见性过滤)
// 本模块接收其结果,做编号、diff——纯函数可单测。

/** 给收集到的元素分配稳定 ref(结构指纹序) 并产出清单。 */
export function buildInventory(collected, { max = INVENTORY_MAX, textSlice = ITEM_TEXT_SLICE } = {}) {
  const counts = new Map()
  const keyed = collected.map((item) => {
    const sameSignatureIndex = counts.get(item.tagName + '|' + item.text) ?? 0
    counts.set(item.tagName + '|' + item.text, sameSignatureIndex + 1)
    return { ...item, key: stableKey(item.tagName, item.text, sameSignatureIndex) }
  })
  return keyed.slice(0, max).map((item, i) => ({
    ref: i + 1,
    tag: item.tagName.toLowerCase(),
    text: String(item.text).slice(0, textSlice),
    key: item.key,
  }))
}

/** 两次清单 diff: changed = 新编号或文本变化;removed = 上次在、这次不在的编号。 */
export function diffInventory(prev, next) {
  const prevByKey = new Map(prev.map((i) => [i.key, i]))
  const nextByKey = new Map(next.map((i) => [i.key, i]))
  const changedRefs = []
  const changed = []
  for (const item of next) {
    const before = prevByKey.get(item.key)
    if (before === undefined || before.text !== item.text) {
      changedRefs.push(item.ref)
      changed.push({ ref: item.ref, tag: item.tag, text: item.text })
    }
  }
  const removedRefs = []
  for (const item of prev) {
    if (!nextByKey.has(item.key)) removedRefs.push(item.ref)
  }
  return { changedRefs, changed, removedRefs }
}

// browser 侧收集脚本(evaluate 注入,写回 data-dsh-el 便于 ref 直达)
export const COLLECT_SCRIPT = `(() => {
  const SEL = ${JSON.stringify(INTERACTIVE_SELECTOR)}
  const ATTR = ${JSON.stringify(DSH_EL_ATTRIBUTE)}
  const isVisible = (el) => {
    const s = getComputedStyle(el)
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const textOf = (el) => (el.innerText ?? el.getAttribute('aria-label') ?? el.value ?? '').trim()
  const out = []
  for (const el of document.querySelectorAll(SEL)) {
    if (!isVisible(el)) continue
    out.push({ tagName: el.tagName, text: textOf(el) })
  }
  return out
})()`

// click 侧 ref 直达脚本: data-dsh-el 在场才找得到;不在场=未先 withRefs 列清单
export const REF_LOOKUP_SCRIPT = (ref) => `(() => {
  const el = document.querySelector('[${DSH_EL_ATTRIBUTE}="${ref}"]')
  return el !== null
})()`

export const DSH_EL_ATTR = DSH_EL_ATTRIBUTE
