import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionManager } from '../src/server/session-manager.js'
import { createTools } from '../src/server/tools.js'
import { AuthError, NO_TOKEN_HINT } from '../src/core/auth.js'
import { ScenarioSchemaError } from '../src/scenario/schema.js'

const parse = (r) => JSON.parse(r.content[0].text)

const makePage = ({ url = 'http://127.0.0.1:3080/wb?token=secret', title = 'T', body = '正文内容', clickOk = true } = {}) => ({
  url: () => url,
  title: () => Promise.resolve(title),
  waitForTimeout: vi.fn(async () => {}),
  screenshot: vi.fn(async ({ path }) => ({ path })),
  locator(sel) {
    if (sel === 'body') return { innerText: async () => body }
    const loc = {
      click: async () => { if (!clickOk) throw new Error('nope') },
      fill: async () => {},
      first: () => loc,
    }
    return loc
  },
  getByText() { return this.locator('text') },
  getByRole() { return this.locator('role') },
})

const makeManager = (page, openImpl) =>
  createSessionManager({ open: openImpl ?? (async () => ({
    page,
    context: { close: vi.fn(async () => {}) },
    collectors: { consoleErrors: ['e1'], failedRequests: ['f1'] },
    authMode: 'cookie',
    baseUrl: 'http://127.0.0.1:3080/',
  })) })

describe('server tools', () => {
  let dir
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'gui-eyes-srv-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  const makeTools = (page, openImpl) => {
    const manager = makeManager(page, openImpl)
    return { manager, tools: createTools({ manager, shotsDir: () => dir }) }
  }

  it('guiOpen returns the report snapshot with token masked and collectors capped', async () => {
    const { tools } = makeTools(makePage())
    const r = parse(await tools.guiOpen({}))
    expect(r).toMatchObject({
      auth_mode: 'cookie',
      final_url: 'http://127.0.0.1:3080/wb?token=***',
      title: 'T',
      body_text_head: '正文内容',
      console_errors: ['e1'],
      failed_requests: ['f1'],
    })
  })

  it('guiOpen wraps NO_TOKEN into a structured error result', async () => {
    const { tools } = makeTools(makePage(), async () => { throw new AuthError('NO_TOKEN', NO_TOKEN_HINT) })
    const err = await tools.guiOpen({}).catch(e => e)
    expect(err).toBeInstanceOf(AuthError)
    const shaped = tools.wrapError(err)
    expect(shaped.isError).toBe(true)
    expect(parse(shaped)).toEqual({ error: 'NO_TOKEN', hint: NO_TOKEN_HINT })
  })

  it('other tools before open shape NO_SESSION, not a crash', async () => {
    const { tools } = makeTools(makePage())
    const err = await tools.guiClick({ text: 'x' }).catch(e => e)
    const shaped = tools.wrapError(err)
    expect(shaped.isError).toBe(true)
    expect(parse(shaped).error).toBe('NO_SESSION')
  })

  it('guiClick clicks, settles, reports masked url; click failure stays structured', async () => {
    const { tools, manager } = makeTools(makePage())
    await manager.open({})
    const ok = parse(await tools.guiClick({ text: '任意文案' }))
    expect(ok).toEqual({ ok: true, final_url: 'http://127.0.0.1:3080/wb?token=***' })
    const { tools: t2, manager: m2 } = makeTools(makePage({ clickOk: false }))
    await m2.open({})
    const bad = parse(await t2.guiClick({ text: '不存在' }))
    expect(bad.ok).toBe(false)
  })

  it('guiType fills and settles; guiDom slices head', async () => {
    const { tools, manager } = makeTools(makePage())
    await manager.open({})
    expect(parse(await tools.guiType({ into: '#q', text: 'hi' })).ok).toBe(true)
    const dom = parse(await tools.guiDom({}))
    expect(dom.text).toBe('正文内容')
    const short = parse(await tools.guiDom({ head: 2 }))
    expect(short.text).toBe('正文')
  })

  it('guiShot writes an absolute timestamped path under shotsDir', async () => {
    const { tools, manager } = makeTools(makePage())
    await manager.open({})
    const r = parse(await tools.guiShot({ name: 'mcp' }))
    expect(r.ok).toBe(true)
    expect(r.path.startsWith(dir)).toBe(true)
    expect(r.path).toMatch(/mcp-\d+\.png$/)
  })

  it('guiAssert runs every rule and folds ok', async () => {
    const { tools, manager } = makeTools(makePage({ body: '保存 取消' }))
    await manager.open({})
    const r = parse(await tools.guiAssert({ asserts: [{ textVisible: '保存' }, { textNotVisible: '关闭' }, { textVisible: '不在场' }] }))
    expect(r.ok).toBe(false)
    expect(r.results.map(x => x.ok)).toEqual([true, true, false])
  })

  it('guiRun loads, runs, folds ok and defaults outDir to shotsDir', async () => {
    const load = vi.fn(async () => ({ name: 'demo', target: 'dsh-web', steps: [{ wait: 1 }], asserts: [{ textVisible: '正文内容' }], outDir: undefined, head: undefined, description: undefined }))
    const run = vi.fn(async (page, scenario, ctx) => {
      ctx.shots.push(join(ctx.outDir, 'x.png'))
      return { steps: [{ action: 'wait', arg: 1, ok: true }], asserts: [{ rule: 'r', ok: true, detail: 'd' }] }
    })
    const { manager } = makeTools(makePage())
    await manager.open({})
    const t = createTools({ manager, shotsDir: () => dir, load, run })
    const out = parse(await t.guiRun({ scenario: 'demo.yaml' }))
    expect(out).toEqual({ ok: true, steps: [{ action: 'wait', arg: 1, ok: true }], asserts: [{ rule: 'r', ok: true, detail: 'd' }], shots: [join(dir, 'x.png')] })
    expect(load).toHaveBeenCalledWith('demo.yaml')
  })

  it('guiShot defaults shotsDir to the engine repo shots/ when not injected (regression: default must stay a function)', async () => {
    const { manager } = makeTools(makePage())
    await manager.open({})
    const tools = createTools({ manager })
    const r = parse(await tools.guiShot({ name: 'unit-default' }))
    expect(r.ok).toBe(true)
    expect(r.path).toMatch(/dsh-gui-eyes\/shots\/unit-default-\d+\.png$/)
  })

  it('wrapError shapes schema errors as INVALID_SCENARIO and passes others through', async () => {
    const { tools } = makeTools(makePage())
    const schemaErr = tools.wrapError(new ScenarioSchemaError([{ path: 'name', message: 'x' }]))
    expect(parse(schemaErr)).toEqual({ error: 'INVALID_SCENARIO', errors: [{ path: 'name', message: 'x' }] })
    expect(tools.wrapError(new Error('boom'))).toBeNull()
  })
})
