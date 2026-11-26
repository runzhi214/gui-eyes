import { describe, it, expect } from 'vitest'
import { stableKey, buildInventory, diffInventory } from '../src/core/inventory.js'

const collected = (items) => items.map(([tagName, text]) => ({ tagName, text }))

describe('stableKey(结构指纹)', () => {
  it('same signature distinguished by index', () => {
    expect(stableKey('BUTTON', '保存', 0)).not.toBe(stableKey('BUTTON', '保存', 1))
    expect(stableKey('BUTTON', '保存', 0)).toBe(stableKey('BUTTON', '保存', 0))
  })
  it('long text truncated to 40 chars — tail drift does not renumber', () => {
    expect(stableKey('P', 'x'.repeat(60), 0)).toBe(stableKey('P', 'x'.repeat(40) + 'Y', 0))
  })
})

describe('buildInventory(编号)', () => {
  it('assigns refs in document order, caps at max, slices text', () => {
    const many = collected([['BUTTON', 'a'], ['A', 'b'], ['INPUT', 'c'.repeat(200)]])
    const inv = buildInventory(many, { max: 30, textSlice: 80 })
    expect(inv.map(i => i.ref)).toEqual([1, 2, 3])
    expect(inv[2].text).toHaveLength(80)
    expect(inv[0].tag).toBe('button')
  })
  it('caps at max(30 budget)', () => {
    const inv = buildInventory(collected(Array.from({ length: 50 }, (_, i) => ['BUTTON', `b${i}`])))
    expect(inv).toHaveLength(30)
  })
  it('same DOM → same numbering (two independent builds agree)', () => {
    const dom = collected([['BUTTON', '保存'], ['BUTTON', '取消'], ['INPUT', '搜索词']])
    expect(buildInventory(dom)).toEqual(buildInventory(dom))
  })
  it('element survival: removing middle element keeps the others identical', () => {
    const before = buildInventory(collected([['BUTTON', 'a'], ['BUTTON', 'b'], ['BUTTON', 'c']]))
    const after = buildInventory(collected([['BUTTON', 'a'], ['BUTTON', 'c']]))
    expect(after.map(i => i.text)).toEqual(['a', 'c'])
    // 结构指纹不变者键一致——diff 语义里 a/c 不算 changed
    const { changedRefs } = diffInventory(before, after)
    expect(changedRefs).toEqual([])
  })
  it('inserted element does not shift existing numbering identity', () => {
    const before = buildInventory(collected([['BUTTON', 'a'], ['BUTTON', 'c']]))
    const after = buildInventory(collected([['BUTTON', 'a'], ['BUTTON', 'b'], ['BUTTON', 'c']]))
    const keyOf = (inv, text) => inv.find(i => i.text === text).key
    expect(keyOf(after, 'a')).toBe(keyOf(before, 'a'))
    expect(keyOf(after, 'c')).toBe(keyOf(before, 'c'))
  })
})

describe('diffInventory(delta 快照)', () => {
  const inv = (pairs) => buildInventory(collected(pairs))
  it('reports new and text-changed elements as changed, vanished as removed', () => {
    const prev = inv([['BUTTON', '提交'], ['BUTTON', '取消']])
    const next = inv([['BUTTON', '提交(禁用)'], ['BUTTON', '新增项']])
    const d = diffInventory(prev, next)
    // 结构指纹语义:文本变化=旧签名移除+新签名出现——removed 与 changed 都含该位。
    // (与 dsh-browser 元素级身份不同:无 content script 的结构指纹做不出「同元素改文本」,
    //  这是设计文档记录的诚实后果,不是 bug)
    expect(d.changedRefs).toEqual([1, 2])
    expect(d.removedRefs).toEqual([1, 2])
    // 「取消」的键既不在 next → removed;其 ref �2 位被「新增项」占据 → 同 ref 双报
  })
  it('unchanged page yields empty diff', () => {
    const same = inv([['BUTTON', 'a'], ['INPUT', 'q']])
    const d = diffInventory(same, inv([['BUTTON', 'a'], ['INPUT', 'q']]))
    expect(d.changedRefs).toEqual([])
    expect(d.removedRefs).toEqual([])
  })
})
