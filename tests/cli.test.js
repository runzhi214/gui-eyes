import { describe, it, expect } from 'vitest'
import { parseArgs, cliMain } from '../src/cli/cli.js'
import { AuthError } from '../src/core/auth.js'
import { UsageError } from '../src/core/usage.js'
import { ScenarioSchemaError } from '../src/scenario/schema.js'

describe('parseArgs (§4.1)', () => {
  it('shot defaults', () => {
    expect(parseArgs(['shot'])).toEqual({ command: 'shot', target: 'dsh-web', outDir: './shots', name: 'shot' })
  })
  it('shot flags', () => {
    expect(parseArgs(['shot', '--target', 'plain', '--base-url', 'http://h/', '--name', 'demo', '--out-dir', 'x']))
      .toEqual({ command: 'shot', target: 'plain', outDir: 'x', name: 'demo', baseUrl: 'http://h/' })
  })
  it('dom head must be a positive integer', () => {
    expect(parseArgs(['dom', '--head', '100']).head).toBe(100)
    expect(parseArgs(['dom', '--head', '0']).error).toContain('正整数')
    expect(parseArgs(['dom', '--head', 'abc']).error).toContain('正整数')
  })
  it('run requires the scenario positional and parses timeout-scale', () => {
    expect(parseArgs(['run']).error).toContain('缺少场景文件参数')
    expect(parseArgs(['run', 'a.yaml', '--timeout-scale', '2']).timeoutScale).toBe(2)
    expect(parseArgs(['run', 'a.yaml', '--timeout-scale', '0']).error).toContain('正数')
    expect(parseArgs(['run', 'a.yaml', 'b.yaml']).error).toContain('多余的位置参数')
  })
  it('rejects unknown commands and unknown flags', () => {
    expect(parseArgs([]).error).toContain('unknown command')
    expect(parseArgs(['boom']).error).toContain('unknown command')
    expect(parseArgs(['shot', '--head', '1']).error).toContain('不支持 --head')
    expect(parseArgs(['dom', '--name', 'x']).error).toContain('不支持 --name')
    expect(parseArgs(['shot', 'positional']).error).toContain('未知参数')
    expect(parseArgs(['shot', '--base-url']).error).toContain('缺少取值')
  })
})

// ---- cliMain 全链路(fake 注入) ----

const fakeSession = ({ url = 'http://127.0.0.1:3080/wb', authMode = 'cookie', title = 'T', body = '页面正文' } = {}) => {
  const page = {
    url: () => url,
    title: () => Promise.resolve(title),
    waitForTimeout: async () => {},
    screenshot: async ({ path }) => { page.shotPath = path },
    locator(sel) {
      if (sel === 'body') return { innerText: async () => body }
      throw new Error('unexpected locator')
    },
  }
  const session = {
    page,
    context: { close: async () => {} },
    collectors: { consoleErrors: [], failedRequests: [] },
    authMode,
    baseUrl: 'http://127.0.0.1:3080/',
  }
  return session
}

const makeIo = (session, extra = {}) => {
  const lines = []
  const errs = []
  return {
    lines, errs,
    io: {
      out: (s) => lines.push(JSON.parse(s)),
      err: (s) => errs.push(s),
      env: {},
      openSession: async () => session,
      ...extra,
    },
  }
}

describe('cliMain: dom (§4.3 report contract)', () => {
  it('emits the documented fields and exit 0', async () => {
    const { lines, io } = makeIo(fakeSession())
    const code = await cliMain(['dom'], io)
    expect(code).toBe(0)
    expect(lines).toHaveLength(1)
    expect(Object.keys(lines[0]).sort()).toEqual(
      ['auth_mode', 'body_text_head', 'console_errors', 'failed_requests', 'final_url', 'shots', 'steps', 'title'].sort()
    )
    expect(lines[0]).toMatchObject({ auth_mode: 'cookie', title: 'T', body_text_head: '页面正文' })
  })
  it('head slicing applies', async () => {
    const body = 'x'.repeat(900)
    const { lines, io } = makeIo(fakeSession({ body }))
    await cliMain(['dom', '--head', '10'], io)
    expect(lines[0].body_text_head).toBe('x'.repeat(10))
  })
})

describe('cliMain: run', () => {
  const scenario = { name: 'demo', description: undefined, target: 'dsh-web', outDir: undefined, head: undefined, steps: [{ wait: 1 }], asserts: [{ textVisible: '页面正文' }] }
  const runScenarioImpl = async (page, s, ctx) => ({ steps: [{ action: 'wait', arg: 1, ok: true }], asserts: [{ rule: 'textVisible "页面正文"', ok: true, detail: '命中' }] })

  it('exit 0 when asserts pass; report carries steps and asserts', async () => {
    const { lines, io } = makeIo(fakeSession(), { loadScenario: async () => scenario, runScenario: runScenarioImpl })
    const code = await cliMain(['run', 'demo.yaml'], io)
    expect(code).toBe(0)
    expect(lines[0].asserts[0].ok).toBe(true)
    expect(lines[0].steps[0]).toEqual({ action: 'wait', arg: 1, ok: true })
  })
  it('exit 1 when an assert fails', async () => {
    const failing = async () => ({ steps: [], asserts: [{ rule: 'r', ok: false, detail: 'd' }] })
    const { lines, io } = makeIo(fakeSession(), { loadScenario: async () => scenario, runScenario: failing })
    const code = await cliMain(['run', 'demo.yaml'], io)
    expect(code).toBe(1)
    expect(lines[0].asserts[0].ok).toBe(false)
  })
  it('exit 1 on a failed step even with passing asserts', async () => {
    const stepFail = async () => ({ steps: [{ action: 'click', arg: 'x', ok: false }], asserts: [] })
    const { io } = makeIo(fakeSession(), { loadScenario: async () => scenario, runScenario: stepFail })
    expect(await cliMain(['run', 'demo.yaml'], io)).toBe(1)
  })
  it('exit 2 with NO_TOKEN structure when auth fails', async () => {
    const { lines, io } = makeIo(fakeSession(), {
      loadScenario: async () => scenario,
      openSession: async () => { throw new AuthError('NO_TOKEN', 'hint-text') },
      runScenario: runScenarioImpl,
    })
    const code = await cliMain(['run', 'demo.yaml'], io)
    expect(code).toBe(2)
    expect(lines[0]).toEqual({ error: 'NO_TOKEN', hint: 'hint-text' })
  })
  it('exit 1 with usage error structure when the target is missing its baseUrl (issue #6)', async () => {
    const { lines, io } = makeIo(fakeSession(), {
      openSession: async () => { throw new UsageError('PLAIN_BASE_URL_MISSING', 'hint-plain') },
    })
    const code = await cliMain(['dom', '--target', 'plain'], io)
    expect(code).toBe(1)
    expect(lines[0]).toEqual({ error: 'PLAIN_BASE_URL_MISSING', hint: 'hint-plain' })
  })
  it('exit 1 with INVALID_SCENARIO structure on schema errors', async () => {
    const { lines, io } = makeIo(fakeSession(), {
      loadScenario: async () => { throw new ScenarioSchemaError([{ path: 'name', message: 'must be a non-empty string' }]) },
    })
    const code = await cliMain(['run', 'demo.yaml'], io)
    expect(code).toBe(1)
    expect(lines[0].error).toBe('INVALID_SCENARIO')
    expect(lines[0].errors[0].path).toBe('name')
  })
  it('exit 1 with stderr note when the capture itself throws', async () => {
    const { errs, io } = makeIo(fakeSession(), {
      loadScenario: async () => scenario,
      runScenario: async () => { throw new Error('browser gone') },
    })
    const code = await cliMain(['run', 'demo.yaml'], io)
    expect(code).toBe(1)
    expect(errs[0]).toContain('browser gone')
  })
  it('exit 1 on bad argv', async () => {
    const { errs, io } = makeIo(fakeSession())
    expect(await cliMain(['nope'], io)).toBe(1)
    expect(errs[0]).toContain('unknown command')
  })
})
