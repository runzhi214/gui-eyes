import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSessionManager } from '../src/server/session-manager.js'
import { createTools } from '../src/server/tools.js'
import { AuthError, NO_TOKEN_HINT } from '../src/core/auth.js'
import { UsageError } from '../src/core/usage.js'
import { ScenarioSchemaError } from '../src/scenario/schema.js'

const parse = (r) => JSON.parse(r.content[0].text)

const makePage = ({
  url = 'http://127.0.0.1:3080/wb?token=secret',
  title = 'T',
  body = '正文内容',
  clickOk = true,
  clickError = null,
  matches = 1,
  matchText = '按钮A',
  bodyReadFails = false,
} = {}) => {
  const page = {
    url: () => url,
    title: () => Promise.resolve(title),
    waitForTimeout: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    goto: vi.fn(async () => {}),
    on: vi.fn(),
    isClosed: () => false,
    screenshot: vi.fn(async ({ path }) => ({ path })),
    frameLocator: () => page,
    locator(sel) {
      if (sel === 'body') {
        return { innerText: async () => {
          if (bodyReadFails) throw new Error('Target closed')
          return body
        } }
      }
      const loc = {
        count: async () => matches,
        innerText: async () => matchText,
        click: async () => {
          if (!clickOk) throw clickError ?? new Error('nope')
        },
        fill: async () => { if (!clickOk) throw clickError ?? new Error('nope') },
        first: () => loc,
        nth: () => loc,
        isChecked: async () => false,
        getAttribute: async () => null,
      }
      loc.filter = () => loc
      return loc
    },
    // getByText 与断言引擎同口径: body 子串给真实计数(issue #9)
    getByText(text) {
      const n = body.includes(text) ? 1 : 0
      const loc = { filter: () => ({ count: async () => n }), count: async () => n, first: () => ({ innerText: async () => matchText, click: async () => { if (!clickOk) throw clickError ?? new Error('nope') } }) }
      return loc
    },
    getByRole() { return page.locator('role') },
  }
  return page
}

const makeManager = (page, openImpl) =>
  createSessionManager({ open: openImpl ?? (async () => ({
    page,
    context: { close: vi.fn(async () => {}), newPage: async () => makePage(), pages: () => [page] },
    collectors: { consoleErrors: ['e1'], failedRequests: ['f1'], crashCount: () => 0 },
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

  it('guiOpen returns the report snapshot with token masked, collectors capped and degraded:false', async () => {
    const { tools } = makeTools(makePage())
    const r = parse(await tools.guiOpen({}))
    expect(r).toMatchObject({
      auth_mode: 'cookie',
      final_url: 'http://127.0.0.1:3080/wb?token=***',
      title: 'T',
      body_text_head: '正文内容',
      console_errors: ['e1'],
      failed_requests: ['f1'],
      degraded: false,
      tabs: 1,
    })
    expect(r.degraded_reasons).toBeUndefined()
  })

  it('guiOpen marks degraded:true with reasons when title and body are both empty (issue #1)', async () => {
    const { tools } = makeTools(makePage({ title: '', body: '' }))
    const r = parse(await tools.guiOpen({}))
    expect(r.degraded).toBe(true)
    expect(r.degraded_reasons.join()).toContain('空白页')
  })

  it('guiOpen marks degraded when the renderer crashed (crashCount > 0, issue #1)', async () => {
    const page = makePage()
    const openImpl = async () => ({
      page,
      context: { close: vi.fn(async () => {}), newPage: async () => makePage(), pages: () => [page] },
      collectors: { consoleErrors: [], failedRequests: [], crashCount: () => 2 },
      authMode: 'cookie',
      baseUrl: 'http://127.0.0.1:3080/',
    })
    const tools = createTools({ manager: makeManager(page, openImpl), shotsDir: () => dir })
    const r = parse(await tools.guiOpen({}))
    expect(r.degraded).toBe(true)
    expect(r.degraded_reasons.join()).toContain('崩溃 x2')
  })

  it('guiOpen passes force through to the manager (issue #2)', async () => {
    const open = vi.fn(async () => ({
      page: makePage(),
      context: { close: vi.fn(async () => {}), newPage: async () => makePage(), pages: () => [makePage()] },
      collectors: { consoleErrors: [], failedRequests: [], crashCount: () => 0 },
      authMode: 'cookie',
      baseUrl: 'http://127.0.0.1:3080/',
    }))
    const manager = createSessionManager({ open })
    const tools = createTools({ manager, shotsDir: () => dir })
    await tools.guiOpen({})
    await tools.guiOpen({ force: true })
    expect(open).toHaveBeenCalledTimes(2)
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

  it('guiClick reports matched audit info on success (issue #4)', async () => {
    const { tools, manager } = makeTools(makePage())
    await manager.open({})
    const r = parse(await tools.guiClick({ text: '正文内容' }))
    expect(r).toEqual({ ok: true, final_url: 'http://127.0.0.1:3080/wb?token=***', matches: 1, matched_text: '按钮A' })
  })

  it('guiClick classifies failures: error carries message (issue #1)', async () => {
    const { tools, manager } = makeTools(makePage({ clickOk: false, clickError: new Error('nope') }))
    await manager.open({})
    const r = parse(await tools.guiClick({ text: '正文内容' }))
    expect(r.ok).toBe(false)
    expect(r.error).toBe('error')
    expect(r.message).toBe('nope')
    expect(r.matches).toBe(1)
  })

  it('guiClick classifies timeout and not-found (issue #1)', async () => {
    const timeout = Object.assign(new Error('locator.click: Timeout 8000ms'), { name: 'TimeoutError' })
    const { tools, manager } = makeTools(makePage({ clickOk: false, clickError: timeout }))
    await manager.open({})
    const r = parse(await tools.guiClick({ text: '正文内容' }))
    expect(r.error).toBe('timeout')
    const { tools: t2, manager: m2 } = makeTools(makePage({ matches: 0 }))
    await m2.open({})
    const nf = parse(await t2.guiClick({ text: '不在场' }))
    expect(nf.ok).toBe(false)
    expect(nf.error).toBe('not-found')
    expect(nf.message).toBeUndefined()
  })

  it('guiType fills via into selector or locate, with audit; both/neither is BAD_TYPE_TARGET', async () => {
    const { tools, manager } = makeTools(makePage())
    await manager.open({})
    const r = parse(await tools.guiType({ into: '#q', text: 'hi' }))
    expect(r).toEqual({ ok: true, final_url: 'http://127.0.0.1:3080/wb?token=***', matches: 1, matched_text: '按钮A' })
    const viaLocate = parse(await tools.guiType({ locate: { role: 'textbox', name: '搜索' }, text: 'x' }))
    expect(viaLocate.ok).toBe(true)
    const both = await tools.guiType({ into: '#q', locate: { text: 'a' }, text: 'x' }).catch(e => e)
    expect(both).toBeInstanceOf(UsageError)
    expect(tools.wrapError(both)).toMatchObject({ isError: true })
    expect(parse(tools.wrapError(both)).error).toBe('BAD_TYPE_TARGET')
    const neither = await tools.guiType({ text: 'x' }).catch(e => e)
    expect(neither).toBeInstanceOf(UsageError)
  })

  it('guiType reports failure reasons like click', async () => {
    const { tools, manager } = makeTools(makePage({ clickOk: false, clickError: new Error('not an input') }))
    await manager.open({})
    const r = parse(await tools.guiType({ into: '#q', text: 'hi' }))
    expect(r.ok).toBe(false)
    expect(r.error).toBe('error')
    expect(r.message).toBe('not an input')
  })

  it('guiDom slices head, reports total_length and truncated (issue #6); MCP default head is 2000 (issue #12)', async () => {
    const long = 'x'.repeat(3000)
    const { tools, manager } = makeTools(makePage({ body: long }))
    await manager.open({})
    const dom = parse(await tools.guiDom({ head: 10 }))
    expect(dom).toEqual({ ok: true, text: 'x'.repeat(10), total_length: 3000, truncated: true })
    const full = parse(await tools.guiDom({}))
    expect(full.truncated).toBe(true)
    expect(full.text).toBe('x'.repeat(2000))
    const short = parse(await tools.guiDom({ head: 4000 }))
    expect(short.truncated).toBe(false)
    expect(short.total_length).toBe(3000)
  })

  it('guiDom fails honestly when the body is unreadable instead of returning empty text (issue #1)', async () => {
    const { tools, manager } = makeTools(makePage({ bodyReadFails: true }))
    await manager.open({})
    const r = parse(await tools.guiDom({}))
    expect(r.ok).toBe(false)
    expect(r.error).toBe('Target closed')
  })

  it('guiShot writes an absolute timestamped path under shotsDir; outDir overrides (issue #6)', async () => {
    const { tools, manager } = makeTools(makePage())
    await manager.open({})
    const r = parse(await tools.guiShot({ name: 'mcp' }))
    expect(r.ok).toBe(true)
    expect(r.path.startsWith(dir)).toBe(true)
    expect(r.path).toMatch(/mcp-\d+\.png$/)
    const custom = join(dir, 'custom')
    const r2 = parse(await tools.guiShot({ name: 'nested', outDir: custom }))
    expect(r2.path.startsWith(custom)).toBe(true)
  })

  it('guiShot failure returns ok:false with error and no path (issue #1)', async () => {
    const page = makePage()
    page.screenshot = vi.fn(async () => { throw new Error('page closed') })
    const { tools, manager } = makeTools(page)
    await manager.open({})
    const r = parse(await tools.guiShot({ name: 'boom' }))
    expect(r).toEqual({ ok: false, error: 'page closed' })
  })

  it('guiAssert runs every rule and folds ok', async () => {
    const { tools, manager } = makeTools(makePage({ body: '保存 取消' }))
    await manager.open({})
    const r = parse(await tools.guiAssert({ asserts: [{ textVisible: '保存' }, { textNotVisible: '关闭' }, { textVisible: '不在场' }] }))
    expect(r.ok).toBe(false)
    expect(r.results.map(x => x.ok)).toEqual([true, true, false])
  })

  it('guiRun loads, runs on an isolated page, closes it and reports body_text_head (issue #5)', async () => {
    const interactive = makePage()
    const scenarioPageNew = makePage({ body: '场景正文' })
    let seenPage = null
    const load = vi.fn(async () => ({ name: 'demo', target: 'dsh-web', steps: [{ dom: {} }], asserts: [{ textVisible: '正文内容' }], outDir: undefined, head: undefined, description: undefined }))
    const run = vi.fn(async (page, scenario, ctx) => {
      seenPage = page
      ctx.bodyText = '场景结束时正文'
      ctx.shots.push(join(ctx.outDir, 'x.png'))
      return { steps: [{ action: 'dom', arg: {}, ok: true }], asserts: [{ rule: 'r', ok: true, detail: 'd' }] }
    })
    const openImpl = async () => ({
      page: interactive,
      context: { close: vi.fn(async () => {}), newPage: vi.fn(async () => scenarioPageNew), pages: () => [interactive] },
      collectors: { consoleErrors: ['e1'], failedRequests: ['f1'], crashCount: () => 0 },
      authMode: 'cookie',
      baseUrl: 'http://127.0.0.1:3080/',
    })
    const manager = makeManager(interactive, openImpl)
    const t = createTools({ manager, shotsDir: () => dir, load, run })
    const out = parse(await t.guiRun({ scenario: 'demo.yaml' }))
    expect(out.ok).toBe(true)
    expect(out.body_text_head).toBe('场景结束时正文')
    expect(out.shots).toEqual([join(dir, 'x.png')])
    expect(load).toHaveBeenCalledWith('demo.yaml')
    expect(seenPage).toBe(scenarioPageNew)
    expect(seenPage).not.toBe(interactive)
    expect(interactive.goto).not.toHaveBeenCalled()
    expect(scenarioPageNew.goto).toHaveBeenCalled()
    expect(scenarioPageNew.close).toHaveBeenCalled()
  })

  it('guiShot defaults shotsDir to the engine repo shots/<today> (regression: default must stay a function)', async () => {
    const { manager } = makeTools(makePage())
    await manager.open({})
    const tools = createTools({ manager })
    const r = parse(await tools.guiShot({ name: 'unit-default' }))
    expect(r.ok).toBe(true)
    // 仓根从本测试文件位置推导——断言不耦合 checkout 目录名(CI 曾因 dsh-gui-eyes 字面量挂掉)
    const repoRoot = fileURLToPath(new URL('../', import.meta.url))
    expect(r.path.startsWith(join(repoRoot, 'shots'))).toBe(true)
    expect(r.path).toMatch(new RegExp(`shots/\\d{4}-\\d{2}-\\d{2}/unit-default-\\d+\\.png$`))
  })

  it('wrapError shapes schema errors as INVALID_SCENARIO and passes others through', async () => {
    const { tools } = makeTools(makePage())
    const schemaErr = tools.wrapError(new ScenarioSchemaError([{ path: 'name', message: 'x' }]))
    expect(parse(schemaErr)).toEqual({ error: 'INVALID_SCENARIO', errors: [{ path: 'name', message: 'x' }] })
    expect(tools.wrapError(new Error('boom'))).toBeNull()
  })

  it('tab addressing routes tools to the indexed context page (issue #9)', async () => {
    const main = makePage({ body: 'MAIN' })
    const popup = makePage({ url: 'http://127.0.0.1:3080/popup?token=secret', body: 'POPUP_CONTENT' })
    const openImpl = async () => ({
      page: main,
      context: { close: vi.fn(async () => {}), newPage: async () => makePage(), pages: () => [main, popup] },
      collectors: { consoleErrors: [], failedRequests: [], crashCount: () => 0 },
      authMode: 'cookie',
      baseUrl: 'http://127.0.0.1:3080/',
    })
    const manager = makeManager(main, openImpl)
    const tools = createTools({ manager, shotsDir: () => dir })
    await manager.open({})
    const open1 = parse(await tools.guiOpen({}))
    expect(open1.tabs).toBe(2)
    const dom = parse(await tools.guiDom({ tab: 1 }))
    expect(dom.text).toBe('POPUP_CONTENT')
    const bad = await tools.guiDom({ tab: 5 }).catch(e => e)
    expect(bad).toBeInstanceOf(UsageError)
    expect(parse(tools.wrapError(bad)).error).toBe('NO_SUCH_TAB')
  })

  it('guiDom withRefs lists numbered inventory; guiClick {ref} addresses by number (dsh-browser #1)', async () => {
    const page = makePage({ body: '保存 取消' })
    page.evaluate = vi.fn(async (script, ...args) => {
      if (typeof script === 'string' && script.includes('querySelectorAll')) {
        return [{ tagName: 'BUTTON', text: '保存' }, { tagName: 'BUTTON', text: '取消' }]
      }
      return undefined
    })
    const { tools, manager } = makeTools(page)
    await manager.open({})
    const dom = parse(await tools.guiDom({ withRefs: true }))
    expect(dom.interactive_inventory).toEqual([
      { ref: 1, tag: 'button', text: '保存' },
      { ref: 2, tag: 'button', text: '取消' },
    ])
    const r = parse(await tools.guiClick({ ref: 1 }))
    expect(r.ok).toBe(true)
    expect(r.ref).toBe(1)
  })

  it('guiClick with a missing ref reports not-found and hints withRefs first', async () => {
    const page = makePage({ body: 'x', matches: 0 })
    page.evaluate = vi.fn(async () => [])
    const { tools, manager } = makeTools(page)
    await manager.open({})
    const r = parse(await tools.guiClick({ ref: 9 }))
    expect(r.ok).toBe(false)
    expect(r.error).toBe('not-found')
    expect(r.message).toContain('withRefs')
  })

  it('guiDom delta: first call is full-baseline, second call returns only changes (dsh-browser #4)', async () => {
    const page = makePage({ body: 'x' })
    let inventory = [{ tagName: 'BUTTON', text: '保存' }]
    page.evaluate = vi.fn(async (script) => {
      if (typeof script === 'string' && script.includes('querySelectorAll')) return inventory
      return undefined
    })
    const { tools, manager } = makeTools(page)
    await manager.open({})
    const first = parse(await tools.guiDom({ delta: true }))
    expect(first.delta_note).toContain('基线')
    expect(first.interactive_inventory).toHaveLength(1)
    inventory = [{ tagName: 'BUTTON', text: '保存' }, { tagName: 'BUTTON', text: '新增' }]
    const second = parse(await tools.guiDom({ delta: true }))
    expect(second.changed_refs.map(c => c.text)).toEqual(['新增'])
    expect(second.removed_refs).toEqual([])
  })

  it('guiShot fullPage passes through to screenshot (issue #9)', async () => {
    const page = makePage()
    const { tools, manager } = makeTools(page)
    await manager.open({})
    await tools.guiShot({ name: 'fp', fullPage: true })
    expect(page.screenshot).toHaveBeenCalledWith(expect.objectContaining({ fullPage: true }))
    await tools.guiShot({ name: 'vp' })
    expect(page.screenshot).toHaveBeenLastCalledWith(expect.not.objectContaining({ fullPage: true }))
  })
})
