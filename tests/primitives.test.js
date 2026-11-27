import { describe, it, expect } from 'vitest'
import { fillOrKeyboard } from '../src/core/primitives.js'

const makeLocator = ({ editable = false, evaluateThrows = false } = {}) => {
  const calls = []
  const loc = {
    calls,
    async evaluate() { if (evaluateThrows) throw new Error('detached'); return editable },
    async click(o) { calls.push(['click', o]) },
    async press(k, o) { calls.push(['press', k, o]) },
    async pressSequentially(t, o) { calls.push(['pressSequentially', t, o]) },
    async fill(t, o) { calls.push(['fill', t, o]) },
  }
  return loc
}

describe('fillOrKeyboard (#24 contenteditable 键盘路径)', () => {
  it('contenteditable 走键盘路径: click→selectAll→Delete→逐字输入,不调 fill', async () => {
    const loc = makeLocator({ editable: true })
    await fillOrKeyboard(loc, '新内容', { timeout: 500 })
    expect(loc.calls).toEqual([
      ['click', { timeout: 500 }],
      ['press', 'ControlOrMeta+A', { timeout: 500 }],
      ['press', 'Delete', { timeout: 500 }],
      ['pressSequentially', '新内容', { delay: 0 }],
    ])
    expect(loc.calls.some(c => c[0] === 'fill')).toBe(false)
  })
  it('contenteditable 空串=纯清空,不触发逐字输入', async () => {
    const loc = makeLocator({ editable: true })
    await fillOrKeyboard(loc, '')
    expect(loc.calls.map(c => c[0])).toEqual(['click', 'press', 'press'])
  })
  it('普通 input/textarea 走 fill,零键盘事件', async () => {
    const loc = makeLocator()
    await fillOrKeyboard(loc, 'abc', { timeout: 700 })
    expect(loc.calls).toEqual([['fill', 'abc', { timeout: 700 }]])
  })
  it('evaluate 失败(元素 detach 等)兜底回 fill,行为不劣化', async () => {
    const loc = makeLocator({ evaluateThrows: true })
    await fillOrKeyboard(loc, 'x')
    expect(loc.calls).toEqual([['fill', 'x', { timeout: 8000 }]])
  })
})
