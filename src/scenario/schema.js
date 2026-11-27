export const STEP_KEYS = ['goto', 'wait', 'click', 'type', 'shot', 'dom', 'assert']
export const ASSERT_RULES = ['textVisible', 'textNotVisible', 'attrMatches', 'count', 'textMatches', 'checked']
export const SCENARIO_FIELDS = ['name', 'description', 'target', 'outDir', 'head', 'strict', 'steps', 'asserts']
export const TARGET_KEYS = ['dsh-web', 'plain']
export const AUTH_KEYS = ['dsh-cookie', 'none']

export class ScenarioSchemaError extends Error {
  constructor(errors) {
    super(`invalid scenario: ${errors.map(e => `${e.path}: ${e.message}`).join('; ')}`)
    this.name = 'ScenarioSchemaError'
    this.errors = errors
  }
}

const fail = (errors, path, message) => errors.push({ path, message })

const isString = (v) => typeof v === 'string'
const isNonEmptyString = (v) => isString(v) && v.length > 0

function validateClickArg(arg, path, errors) {
  if (isString(arg)) return
  if (typeof arg !== 'object' || arg === null || Array.isArray(arg)) {
    return fail(errors, path, 'click must be a text string or an object')
  }
  const modes = ['text', 'role', 'selector'].filter(k => arg[k] !== undefined)
  if (modes.length !== 1) {
    return fail(errors, path, `click must pick exactly one of text | role+name | selector, got [${modes.join(',')}]`)
  }
  const extra = Object.keys(arg).filter(k => !['text', 'role', 'name', 'selector', 'exact', 'ifNotVisible', 'frame'].includes(k))
  if (extra.length > 0) fail(errors, path, `unknown click field(s): ${extra.join(',')}`)
  if (arg.text !== undefined && !isString(arg.text)) fail(errors, path, 'click.text must be a string')
  if (arg.role !== undefined) {
    if (!isNonEmptyString(arg.role) || !isString(arg.name)) fail(errors, path, 'click needs role and name strings together')
  }
  if (arg.selector !== undefined && !isNonEmptyString(arg.selector)) fail(errors, path, 'click.selector must be a non-empty string')
  if (arg.exact !== undefined && typeof arg.exact !== 'boolean') fail(errors, path, 'click.exact must be a boolean')
  if (arg.ifNotVisible !== undefined && !isNonEmptyString(arg.ifNotVisible)) {
    fail(errors, path, 'click.ifNotVisible must be a non-empty string')
  }
  if (arg.frame !== undefined && !isNonEmptyString(arg.frame)) fail(errors, path, 'click.frame must be a non-empty selector string')
}

function validateAssertArg(rule, arg, path, errors) {
  const needObj = () => {
    if (typeof arg !== 'object' || arg === null || Array.isArray(arg)) {
      fail(errors, path, `${rule} needs an object argument`)
      return false
    }
    return true
  }
  const needStr = (field, extra = []) => {
    const allowed = ['selector', 'attr', 'regex', 'hasText', 'equals', 'all', 'frame', ...extra]
    if (!isNonEmptyString(arg[field])) fail(errors, path, `${rule}.${field} must be a non-empty string`)
    const unknown = Object.keys(arg).filter(k => !allowed.includes(k))
    if (unknown.length > 0) fail(errors, path, `${rule} unknown field(s): ${unknown.join(',')}`)
  }
  switch (rule) {
    case 'textVisible':
    case 'textNotVisible':
      // string 或 {text, frame}(issue #9: iframe 内文本断言);frame 缺省即主文档
      if (isNonEmptyString(arg)) return
      if (typeof arg !== 'object' || arg === null || Array.isArray(arg)) {
        return fail(errors, path, `${rule} must be a non-empty string or {text, frame}`)
      }
      needStr('text', ['text'])
      return
    case 'attrMatches':
      if (!needObj()) return
      needStr('selector'); needStr('attr'); needStr('regex')
      return
    case 'count': {
      if (!needObj()) return
      needStr('selector', [])
      if (!Number.isInteger(arg.equals)) fail(errors, path, 'count.equals must be an integer')
      return
    }
    case 'textMatches':
      if (!needObj()) return
      needStr('selector'); needStr('regex')
      return
    case 'checked':
      if (!needObj()) return
      needStr('selector')
      if (arg.all !== true) fail(errors, path, 'checked.all must be true')
      return
  }
}

function validateAssertEntry(entry, path, errors) {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return fail(errors, path, 'assert entry must be a single-key {rule: arg} object')
  }
  const keys = Object.keys(entry)
  if (keys.length !== 1) return fail(errors, path, `assert entry must have exactly one rule key, got [${keys.join(',')}]`)
  const rule = keys[0]
  if (!ASSERT_RULES.includes(rule)) return fail(errors, path, `unknown assert rule "${rule}" (allowed: ${ASSERT_RULES.join(', ')})`)
  validateAssertArg(rule, entry[rule], `${path}.${rule}`, errors)
}

function validateStepEntry(entry, path, errors) {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return fail(errors, path, 'step must be a single-key object')
  }
  const keys = Object.keys(entry)
  if (keys.length !== 1) return fail(errors, path, `step must have exactly one action key, got [${keys.join(',')}]`)
  const [action] = keys
  const arg = entry[action]
  const argPath = `${path}.${action}`
  switch (action) {
    case 'goto':
      if (!isNonEmptyString(arg)) fail(errors, argPath, 'goto must be a non-empty path string')
      return
    case 'wait':
      if (typeof arg !== 'number' || !(arg > 0)) fail(errors, argPath, 'wait must be a positive number of milliseconds')
      return
    case 'click':
      validateClickArg(arg, argPath, errors)
      return
    case 'type': {
      if (typeof arg !== 'object' || arg === null || Array.isArray(arg)) {
        return fail(errors, argPath, 'type must be {into, text}')
      }
      const unknown = Object.keys(arg).filter(k => !['into', 'text', 'frame'].includes(k))
      if (unknown.length > 0) fail(errors, argPath, `type unknown field(s): ${unknown.join(',')}`)
      if (!isNonEmptyString(arg.into)) fail(errors, argPath, 'type.into must be a non-empty selector')
      if (!isString(arg.text)) fail(errors, argPath, 'type.text must be a string')
      if (arg.frame !== undefined && !isNonEmptyString(arg.frame)) fail(errors, argPath, 'type.frame must be a non-empty selector string')
      return
    }
    case 'shot':
      if (!isNonEmptyString(arg)) fail(errors, argPath, 'shot must be a non-empty name string')
      return
    case 'dom':
      if (arg !== null && (typeof arg !== 'object' || Array.isArray(arg) || Object.keys(arg).length > 0)) {
        fail(errors, argPath, 'dom must be {} or empty')
      }
      return
    case 'assert':
      validateAssertEntry(arg, `${path}.assert`, errors)
      return
    default:
      fail(errors, path, `unknown step action "${action}" (allowed: ${STEP_KEYS.join(', ')})`)
  }
}

function validateTarget(target, errors) {
  if (isString(target)) {
    if (!TARGET_KEYS.includes(target)) fail(errors, 'target', `unknown target "${target}" (allowed: ${TARGET_KEYS.join(', ')}) or inline {baseUrl, auth}`)
    return
  }
  if (typeof target !== 'object' || target === null || Array.isArray(target)) {
    return fail(errors, 'target', 'target must be a key string or an inline {baseUrl, auth} object')
  }
  const unknown = Object.keys(target).filter(k => !['baseUrl', 'auth'].includes(k))
  if (unknown.length > 0) fail(errors, 'target', `unknown target field(s): ${unknown.join(',')}`)
  if (!isNonEmptyString(target.baseUrl)) fail(errors, 'target.baseUrl', 'must be a non-empty URL string')
  if (target.auth !== undefined && !AUTH_KEYS.includes(target.auth)) {
    fail(errors, 'target.auth', `must be one of ${AUTH_KEYS.join(', ')}`)
  }
}

export function validateScenario(obj) {
  const errors = []
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    throw new ScenarioSchemaError([{ path: '$', message: 'scenario must be a mapping' }])
  }
  const unknown = Object.keys(obj).filter(k => !SCENARIO_FIELDS.includes(k))
  if (unknown.length > 0) fail(errors, '$', `unknown field(s): ${unknown.join(',')}`)
  if (!isNonEmptyString(obj.name)) fail(errors, 'name', 'must be a non-empty string')
  if (obj.description !== undefined && !isString(obj.description)) fail(errors, 'description', 'must be a string')
  if (obj.target !== undefined) validateTarget(obj.target, errors)
  if (obj.outDir !== undefined && !isNonEmptyString(obj.outDir)) fail(errors, 'outDir', 'must be a non-empty path string')
  if (obj.head !== undefined && (!Number.isInteger(obj.head) || obj.head <= 0)) fail(errors, 'head', 'must be a positive integer')
  // strict(#27): 可选严格模式——遇第一个失败步骤即停;缺省 catch-continue 契约不变
  if (obj.strict !== undefined && typeof obj.strict !== 'boolean') fail(errors, 'strict', 'must be a boolean')
  if (!Array.isArray(obj.steps)) fail(errors, 'steps', 'must be an array')
  else obj.steps.forEach((entry, i) => validateStepEntry(entry, `steps[${i}]`, errors))
  if (obj.asserts !== undefined) {
    if (!Array.isArray(obj.asserts)) fail(errors, 'asserts', 'must be an array')
    else obj.asserts.forEach((entry, i) => validateAssertEntry(entry, `asserts[${i}]`, errors))
  }
  if (errors.length > 0) throw new ScenarioSchemaError(errors)
  return {
    name: obj.name,
    description: obj.description,
    target: obj.target ?? 'dsh-web',
    outDir: obj.outDir,
    head: obj.head,
    strict: obj.strict === true,
    steps: obj.steps,
    asserts: obj.asserts ?? [],
  }
}
