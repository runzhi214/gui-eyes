import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { clickLocator, locateAll, CLICK_TIMEOUT_MS, TYPE_TIMEOUT_MS } from '../core/primitives.js'
import { runAsserts } from '../core/asserts.js'
import { createCollectors } from '../core/observe.js'
import { buildInventory, diffInventory, COLLECT_SCRIPT, DSH_EL_ATTR } from '../core/inventory.js'
import { loadScenario } from '../scenario/load.js'
import { runScenario } from '../scenario/runner.js'
import { maskToken, shapeConsoleErrors, shapeFailedRequests } from '../core/report.js'
import { launchEphemeralBrowser } from '../core/browser.js'
import { VIEWPORT } from '../core/config.js'
import { UsageError } from '../core/usage.js'
import { AuthError } from '../core/auth.js'
import { ScenarioSchemaError } from '../scenario/schema.js'

export const SETTLE_MS = 800
export const DEFAULT_HEAD_CHARS = 600
// MCP gui_dom 默认头部(issue #12): 设置面板类验证 600 偏小;CLI 契约默认仍 600 不变
export const MCP_DOM_HEAD_CHARS = 2000
export const MATCHED_TEXT_SLICE = 80
// #19: call log 里的 intercepts/covered by 是定性信息,120 太窄——放宽到 400 仍可控
export const MESSAGE_SLICE = 400

// 截图默认落引擎仓 shots/<今日>/(绝对路径,agent 拿到即可 read_image)
const REPO_ROOT = resolve(join(fileURLToPath(import.meta.url), '../../..'))
const today = () => new Date().toISOString().slice(0, 10)
export const defaultShotsDir = () => join(REPO_ROOT, 'shots', today())

const json = (payload) => ({ content: [{ type: 'text', text: JSON.stringify(payload) }] })
const clipMessage = (e) => String(e?.message ?? e).slice(0, MESSAGE_SLICE)

// 正文读取失败吞为空串仅在 guiOpen 使用:degraded 字段把该失败显式化,不再隐没
const bodyText = (page) => page.locator('body').innerText({ timeout: 5000 }).catch(() => '')

// 审计信息:命中数 + 首个命中元素文本摘要(text 默认非精确、取 first,歧义必须显式可见)
async function clickAudit(locator) {
  const matches = await locator.count().catch(() => 0)
  if (matches === 0) return { matches }
  const text = await locator.first().innerText().catch(() => '')
  return { matches, ...(text !== '' ? { matched_text: text.slice(0, MATCHED_TEXT_SLICE) } : {}) }
}

// 失败分类;obscured 时从 call log 点名遮挡者(issue #19: intercepts pointer events/covered by 是定性信息)
const reasonFor = (e) => {
  const msg = e?.message ?? ''
  if (e?.name === 'TimeoutError') return /intercept|covered by|outside of the viewport/i.test(msg) ? 'obscured' : 'timeout'
  if (/intercept|covered by|outside of the viewport/i.test(msg)) return 'obscured'
  return 'error'
}

// 从 call log 抽遮挡者描述行(issue #19)
const obscuredBy = (e) => {
  const m = String(e?.message ?? '').match(/<([^>]+)>\s+(?:intercepts pointer events|is covered by)/i)
  return m ? `<${m[1]}>` : undefined
}

// tab 寻址(issue #9): popup/多页场景下用 context.pages() 定位;越界报结构化错误而非崩溃
const pageFor = (session, tab) => {
  if (tab === undefined) return session.page
  const pages = session.context.pages()
  if (!Number.isInteger(tab) || tab < 0 || tab >= pages.length) {
    throw new UsageError('NO_SUCH_TAB', `tab ${tab} 不存在;当前 context 共 ${pages.length} 页`)
  }
  return pages[tab]
}

// ref → data-dsh-el 直达定位(模块级,guiClick/guiType/refAudit 共用)
const refLocator = (page, ref) => page.locator(`[${DSH_EL_ATTR}="${ref}"]`)

// ref 通道的审计: 元素在场(属性命中)给 matched_text;不在场 matches:0
async function refAudit(page, ref) {
  const locator = refLocator(page, ref)
  const matches = await locator.count().catch(() => 0)
  if (matches === 0) return { matches }
  const text = await locator.first().innerText().catch(() => '')
  return { matches, ...(text !== '' ? { matched_text: text.slice(0, MATCHED_TEXT_SLICE) } : {}), ref }
}

// ref 直达的写回: 清单编号写上 DOM(data-dsh-el),click/type 按 ref 取属性直达
// 注意 playwright evaluate 只收一个附加参数——多参数必须包对象
async function writeBackRefs(page, inventory) {
  const payload = { attr: DSH_EL_ATTR, entries: inventory.map((item, i) => ({ index: i + 1, ref: item.ref })) }
  return page.evaluate(({ attr, entries }) => {
    for (const el of document.querySelectorAll(`[${attr}]`)) el.removeAttribute(attr)
    const SEL = 'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], summary, [contenteditable="true"], [contenteditable=""]'
    const visible = [...document.querySelectorAll(SEL)].filter((el) => {
      const s = getComputedStyle(el)
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    })
    entries.forEach((entry) => {
      const el = visible[entry.index - 1]
      if (el) el.setAttribute(attr, String(entry.ref))
    })
  }, payload)
}

export function createTools({ manager, shotsDir = defaultShotsDir, settleMs = SETTLE_MS, load = loadScenario, run = runScenario, runLaunch } = {}) {
  const settle = (page) => page.waitForTimeout(settleMs)

  // delta 基线按会话内存管理: force 重开即清空(诚实语义——重开=全新基线)
  let inventoryBaseline = null



  // 收集页面上可见交互元素并按结构指纹编号(纯逻辑在 core/inventory,此处管 browser 侧)
  const collectInteractive = async (page) => {
    const collected = await page.evaluate(COLLECT_SCRIPT)
    return buildInventory(collected)
  }

  return {
    async guiOpen({ target, baseUrl, force } = {}) {
      const session = await manager.open({ target, baseUrl, force })
      const title = await session.page.title().catch(() => '')
      const body = await bodyText(session.page)
      const crashes = session.collectors.crashCount()
      const degradedReasons = []
      if (crashes > 0) degradedReasons.push(`页面渲染进程崩溃 x${crashes}`)
      if (title === '' && body === '') degradedReasons.push('标题与正文均为空(疑似空白页/崩溃/未渲染)')
      return json({
        auth_mode: session.authMode,
        final_url: maskToken(session.page.url()),
        title,
        body_text_head: body.slice(0, DEFAULT_HEAD_CHARS),
        tabs: session.context.pages().length,
        console_errors: shapeConsoleErrors(session.collectors.consoleErrors),
        failed_requests: shapeFailedRequests(session.collectors.failedRequests),
        degraded: degradedReasons.length > 0,
        ...(degradedReasons.length > 0 ? { degraded_reasons: degradedReasons } : {}),
      })
    },

    async guiClick(spec) {
      const session = manager.current()
      const { tab, ...clickSpec } = spec ?? {}
      const page = pageFor(session, tab)
      // ref 通道(编号寻址): data-dsh-el 直达;未先 withRefs 列清单则属性不在场 → not-found 带提示
      const byRef = clickSpec.ref !== undefined
      const locator = byRef ? refLocator(page, clickSpec.ref) : clickLocator(page, clickSpec)
      const audit = byRef
        ? await refAudit(page, clickSpec.ref)
        : await clickAudit(locateAll(page, clickSpec))
      let error = audit.matches === 0 ? 'not-found' : null
      let failureMessage
      let obscuredByEl
      if (error === null) {
        try {
          await locator.click({ timeout: CLICK_TIMEOUT_MS })
        } catch (e) {
          error = reasonFor(e)
          failureMessage = clipMessage(e)
          if (error === 'obscured') obscuredByEl = obscuredBy(e)
          // ref 编号被 React 重渲染抹掉后只剩通用 timeout——显式提示快照过期(#21)
          if (error === 'timeout' && byRef) {
            failureMessage = `${failureMessage}\n提示: ref ${clickSpec.ref} 的 data-dsh-el 标记可能已被页面重渲染清除——重新 gui_dom {withRefs:true} 采集后再点`
          }
        }
      } else if (byRef) {
        failureMessage = `ref ${clickSpec.ref} 不在场——先用 gui_dom {withRefs: true} 列出编号清单`
      }
      await settle(page)
      return json({
        ok: error === null,
        final_url: maskToken(page.url()),
        ...audit,
        ...(error !== null ? { error, message: failureMessage, ...(obscuredByEl !== undefined ? { obscured_by: obscuredByEl } : {}) } : {}),
      })
    },

    async guiType({ into, text, locate, tab } = {}) {
      if ((into !== undefined) === (locate !== undefined)) {
        throw new UsageError('BAD_TYPE_TARGET', 'into(CSS 选择器) 与 locate(text|role+name|selector|ref) 必须二选一')
      }
      const session = manager.current()
      const page = pageFor(session, tab)
      const byRef = locate?.ref !== undefined
      const full = byRef
        ? refLocator(page, locate.ref)
        : (locate !== undefined ? locateAll(page, locate) : page.locator(into))
      const audit = await clickAudit(full)
      let error = audit.matches === 0 ? 'not-found' : null
      let failureMessage
      if (error === null) {
        try {
          await full.first().fill(text, { timeout: TYPE_TIMEOUT_MS })
        } catch (e) {
          error = reasonFor(e)
          failureMessage = clipMessage(e)
        }
      } else if (byRef) {
        failureMessage = `ref ${locate.ref} 不在场——先用 gui_dom {withRefs: true} 列出编号清单`
      }
      await settle(page)
      return json({
        ok: error === null,
        final_url: maskToken(page.url()),
        ...audit,
        ...(error !== null ? { error, message: failureMessage } : {}),
      })
    },

    async guiShot({ name, outDir, fullPage, tab, wait, selector } = {}) {
      const session = manager.current()
      const page = pageFor(session, tab)
      // 条件先行(issue #20): 瞬态 UI(toast 等)先等条件命中再截,不再 sleep+盲抓;
      // 超时如实报 timeout,「没出现」与「抓错时机」从此可区分
      if (wait !== undefined) {
        try {
          if (wait.text !== undefined) {
            await page.getByText(wait.text).first().waitFor({ timeout: wait.timeoutMs ?? 8000 })
          } else if (wait.selector !== undefined) {
            await page.locator(wait.selector).first().waitFor({ timeout: wait.timeoutMs ?? 8000 })
          } else {
            throw new UsageError('BAD_WAIT', 'wait 需要 {text} 或 {selector} 二选一(可选 timeoutMs)')
          }
        } catch (e) {
          const reason = e?.name === 'TimeoutError' ? 'timeout' : 'error'
          return json({ ok: false, error: reason, message: clipMessage(e) })
        }
      }
      const dir = outDir !== undefined ? resolve(outDir) : shotsDir()
      mkdirSync(dir, { recursive: true })
      const path = join(dir, `${name}-${Date.now()}.png`)
      try {
        // selector 裁剪(issue #22): 只截目标元素区域,判读提示词歧义自然消失
        if (selector !== undefined) {
          await page.locator(selector).first().screenshot({ path })
        } else {
          await page.screenshot({ path, ...(fullPage === true ? { fullPage: true } : {}) })
        }
        return json({ ok: true, path })
      } catch (e) {
        return json({ ok: false, error: clipMessage(e) })
      }
    },

    async guiDom({ head = MCP_DOM_HEAD_CHARS, tab, withRefs, delta, selector, eval: js } = {}) {
      const session = manager.current()
      const page = pageFor(session, tab)
      // JS 求值逃生舱(issue #18): 与 selector 读取互补——结构问题 3 秒定性,不再绕读图
      if (js !== undefined) {
        try {
          const result = await page.evaluate(js)
          const text = (() => { try { return JSON.stringify(result, null, 1) } catch { return String(result) } })()
          return json({ ok: true, eval_result: text.slice(0, 2000) })
        } catch (e) {
          return json({ ok: false, error: clipMessage(e) })
        }
      }
      // 选择器作用域读取(issue #16): outerHTML 让「容器下有没有节点/崩溃锚点」直接可见
      if (selector !== undefined) {
        try {
          const el = page.locator(selector).first()
          const count = await el.count()
          if (count === 0) return json({ ok: true, selector, matched: 0 })
          const outer = await el.evaluate((node) => node.outerHTML)
          return json({ ok: true, selector, matched: 1, outerHTML: outer.slice(0, 4000), truncated: outer.length > 4000 })
        } catch (e) {
          return json({ ok: false, error: clipMessage(e) })
        }
      }
      let full
      try {
        full = await page.locator('body').innerText({ timeout: 5000 })
      } catch (e) {
        return json({ ok: false, error: clipMessage(e) })
      }
      const response = {
        ok: true,
        text: full.slice(0, head),
        total_length: full.length,
        truncated: full.length > head,
      }
      // console 采集器暴露(issue #17): 数据一直在内存,交互后崩溃的第一信号随取随用
      if (session.collectors.consoleErrors.length > 0) {
        response.console_errors = shapeConsoleErrors(session.collectors.consoleErrors)
      }
      // 编号清单(design-inventory-delta #1): 结构指纹编号 + data-dsh-el 写回供 ref 直达
      if (withRefs === true) {
        const inventory = await collectInteractive(page)
        response.interactive_inventory = inventory.map(({ ref, tag, text }) => ({ ref, tag, text }))
        // 写回失败不吞:清单可读但 ref 直达不可用,warning 如实带出(issue #1 精神:观测点不静默)
        try {
          await writeBackRefs(page, inventory)
        } catch (e) {
          response.ref_writeback_warning = `ref 直达未生效(清单仍可读): ${clipMessage(e)}`
        }
      }
      // delta 快照(#4): 与本会话上次基线 diff,只回变化;首次无基线=全量
      if (delta === true) {
        const inventory = await collectInteractive(page)
        if (inventoryBaseline === null) {
          response.delta_note = '首次快照,返回全量清单作为基线'
          response.interactive_inventory = inventory.map(({ ref, tag, text }) => ({ ref, tag, text }))
        } else {
          const { changed, removedRefs } = diffInventory(inventoryBaseline, inventory)
          response.changed_refs = changed
          response.removed_refs = removedRefs
        }
        inventoryBaseline = inventory
      }
      return json(response)
    },

    async guiAssert({ asserts, tab }) {
      const session = manager.current()
      const page = pageFor(session, tab)
      const results = await runAsserts(page, asserts)
      return json({ ok: results.every(r => r.ok), results })
    },

    async guiRun({ scenario }) {
      const loaded = await load(scenario)
      const session = await manager.open({ target: loaded.target })
      const outDir = loaded.outDir !== undefined ? resolve(loaded.outDir) : shotsDir()
      mkdirSync(outDir, { recursive: true })
      // 独立临时浏览器(issue #14 根治): 连接池/存储与交互会话彻底隔离,同 context 长连占坑
      // 饿死场景页的整族问题消失;storageState 复制注入,30 天 dsh cookie 随行,鉴权不受影响。
      const storageState = await session.context.storageState().catch(() => null)
      const browser = await launchEphemeralBrowser({ ...(runLaunch !== undefined ? { launch: runLaunch } : {}) })
      const ctx = { baseUrl: session.baseUrl, outDir, timeoutScale: 1, shots: [], bodyText: null }
      try {
        const context = await browser.newContext({ ...(storageState !== null ? { storageState } : {}), viewport: VIEWPORT })
        const page = await context.newPage()
        const collectors = createCollectors(page)
        await page.goto(session.baseUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {})
        const { steps, asserts } = await run(page, loaded, ctx)
        const ok = steps.every(s => s.ok) && asserts.every(a => a.ok)
        return json({
          ok,
          steps,
          asserts,
          shots: ctx.shots,
          body_text_head: (ctx.bodyText ?? '').slice(0, loaded.head ?? DEFAULT_HEAD_CHARS),
          console_errors: shapeConsoleErrors(collectors.consoleErrors),
          failed_requests: shapeFailedRequests(collectors.failedRequests),
          // 挂起观测(issue #14): 未 settle 的 in-flight 请求显式列出,不再伪装成断言失败
          pending_requests: collectors.pendingRequests().slice(0, 15),
        })
      } finally {
        await browser.close().catch(() => {})
      }
    },

    // 统一错误面:UsageError/AuthError/SchemaError → 结构化 isError;未知错误原样抛给 SDK
    wrapError(error) {
      if (error instanceof UsageError || error instanceof AuthError) {
        return { isError: true, ...json({ error: error.code, hint: error.hint }) }
      }
      if (error instanceof ScenarioSchemaError) {
        return { isError: true, ...json({ error: 'INVALID_SCENARIO', errors: error.errors }) }
      }
      return null
    },
  }
}
