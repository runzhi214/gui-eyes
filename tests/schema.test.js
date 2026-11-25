import { describe, it, expect } from 'vitest'
import { validateScenario, ScenarioSchemaError } from '../src/scenario/schema.js'

const base = { name: 'x', steps: [] }
const valid = (obj) => () => validateScenario(obj)

describe('scenario schema: top level', () => {
  it('accepts a minimal scenario and applies defaults', () => {
    const s = validateScenario({ name: 'demo', steps: [] })
    expect(s).toEqual({ name: 'demo', description: undefined, target: 'dsh-web', outDir: undefined, head: undefined, steps: [], asserts: [] })
  })
  it('rejects unknown top-level fields', () => {
    expect(valid({ ...base, oops: 1 })).toThrow(ScenarioSchemaError)
    try { validateScenario({ ...base, oops: 1, alsoBad: 2 }) } catch (e) {
      expect(e.errors[0].message).toContain('oops,alsoBad')
    }
  })
  it('requires a non-empty name', () => {
    expect(valid({ steps: [] })).toThrow(ScenarioSchemaError)
    expect(valid({ name: '', steps: [] })).toThrow(ScenarioSchemaError)
  })
  it('requires steps to be an array', () => {
    expect(valid({ name: 'x', steps: 'nope' })).toThrow(ScenarioSchemaError)
  })
  it('validates inline target', () => {
    expect(validateScenario({ ...base, target: { baseUrl: 'http://h/', auth: 'none' } }).target).toEqual({ baseUrl: 'http://h/', auth: 'none' })
    expect(valid({ ...base, target: 'nope' })).toThrow(ScenarioSchemaError)
    expect(valid({ ...base, target: { baseUrl: 'http://h/', auth: 'dsh-cookie', extra: 1 } })).toThrow(ScenarioSchemaError)
    expect(valid({ ...base, target: { baseUrl: 'http://h/', auth: 'bad' } })).toThrow(ScenarioSchemaError)
  })
  it('validates head and outDir types', () => {
    expect(valid({ ...base, head: 0 })).toThrow(ScenarioSchemaError)
    expect(valid({ ...base, head: -3 })).toThrow(ScenarioSchemaError)
    expect(valid({ ...base, outDir: '' })).toThrow(ScenarioSchemaError)
  })
})

describe('scenario schema: steps', () => {
  it('rejects unknown step actions and multi-key steps', () => {
    expect(valid({ ...base, steps: [{ explode: true }] })).toThrow(/unknown step action/)
    expect(valid({ ...base, steps: [{ wait: 1, shot: 'a' }] })).toThrow(/exactly one action key/)
  })
  it('validates goto / wait / shot / dom shapes', () => {
    expect(valid({ ...base, steps: [{ goto: '/' }, { wait: 6000 }, { shot: 'a' }, { dom: {} }, { dom: null }] })).not.toThrow()
    expect(valid({ ...base, steps: [{ goto: '' }] })).toThrow(ScenarioSchemaError)
    expect(valid({ ...base, steps: [{ wait: 0 }] })).toThrow(ScenarioSchemaError)
    expect(valid({ ...base, steps: [{ wait: -1 }] })).toThrow(ScenarioSchemaError)
    expect(valid({ ...base, steps: [{ shot: '' }] })).toThrow(ScenarioSchemaError)
    expect(valid({ ...base, steps: [{ dom: { x: 1 } }] })).toThrow(ScenarioSchemaError)
  })
  it('click accepts a bare text string', () => {
    expect(validateScenario({ ...base, steps: [{ click: '任意文案' }] }).steps[0]).toEqual({ click: '任意文案' })
  })
  it('click enforces exactly one of text | role+name | selector', () => {
    expect(valid({ ...base, steps: [{ click: { text: 'a', selector: 'b' } }] })).toThrow(/exactly one/)
    expect(valid({ ...base, steps: [{ click: { role: 'button' } }] })).toThrow(/role and name/)
    expect(valid({ ...base, steps: [{ click: { role: 'button', name: 'x' } }] })).not.toThrow()
    expect(valid({ ...base, steps: [{ click: { selector: '[a]', ifNotVisible: '资源明细' } }] })).not.toThrow()
    expect(valid({ ...base, steps: [{ click: { text: 'a', bogus: 1 } }] })).toThrow(/unknown click field/)
    expect(valid({ ...base, steps: [{ click: { text: 'a', exact: 'yes' } }] })).toThrow(ScenarioSchemaError)
  })
  it('type requires into and text', () => {
    expect(valid({ ...base, steps: [{ type: { into: '#q', text: 'hi' } }] })).not.toThrow()
    expect(valid({ ...base, steps: [{ type: { into: '#q' } }] })).toThrow(ScenarioSchemaError)
    expect(valid({ ...base, steps: [{ type: { text: 'hi' } }] })).toThrow(ScenarioSchemaError)
    expect(valid({ ...base, steps: [{ type: { into: '#q', text: 'h', extra: 1 } }] })).toThrow(/unknown/)
  })
})

describe('scenario schema: asserts (incl. inline)', () => {
  it('accepts every rule with its documented shape', () => {
    const asserts = [
      { textVisible: '关注服务' },
      { textNotVisible: '关闭' },
      { attrMatches: { selector: '[class*=helpMark]', attr: 'title', regex: '管理类|不计入' } },
      { count: { selector: 'button', hasText: '保存', equals: 1 } },
      { textMatches: { selector: 'button', regex: '服务\\s+\\d+\\s*项' } },
      { checked: { selector: 'input[type=checkbox]', all: true } },
    ]
    expect(valid({ ...base, asserts })).not.toThrow()
    expect(valid({ ...base, steps: [{ assert: asserts[0] }] })).not.toThrow()
  })
  it('rejects unknown rules and multi-key entries', () => {
    expect(valid({ ...base, asserts: [{ nope: 1 }] })).toThrow(/unknown assert rule/)
    expect(valid({ ...base, asserts: [{ textVisible: 'a', count: {} }] })).toThrow(/exactly one rule key/)
  })
  it('rejects bad argument shapes per rule', () => {
    expect(valid({ ...base, asserts: [{ textVisible: '' }] })).toThrow(ScenarioSchemaError)
    expect(valid({ ...base, asserts: [{ attrMatches: { selector: 'a', attr: 'b' } }] })).toThrow(/regex/)
    expect(valid({ ...base, asserts: [{ attrMatches: { selector: 'a', attr: 'b', regex: 'c', x: 1 } }] })).toThrow(/unknown/)
    expect(valid({ ...base, asserts: [{ count: { selector: 'a' } }] })).toThrow(/equals/)
    expect(valid({ ...base, asserts: [{ count: { selector: 'a', equals: 1.5 } }] })).toThrow(ScenarioSchemaError)
    expect(valid({ ...base, asserts: [{ textMatches: { selector: 'a' } }] })).toThrow(ScenarioSchemaError)
    expect(valid({ ...base, asserts: [{ checked: { selector: 'a' } }] })).toThrow(/all/)
    expect(valid({ ...base, asserts: [{ checked: { selector: 'a', all: false } }] })).toThrow(/all/)
  })
  it('collects every error at once for the report', () => {
    try {
      validateScenario({ name: '', steps: [{ wait: 0 }], asserts: [{ nope: 1 }] })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ScenarioSchemaError)
      expect(e.errors.map(x => x.path)).toEqual(['name', 'steps[0].wait', 'asserts[0]'])
    }
  })
})
