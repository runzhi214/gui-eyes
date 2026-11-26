import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { clickLocator, locateAll, CLICK_TIMEOUT_MS, TYPE_TIMEOUT_MS } from '../core/primitives.js'
import { runAsserts } from '../core/asserts.js'
import { createCollectors } from '../core/observe.js'
import { loadScenario } from '../scenario/load.js'
import { runScenario } from '../scenario/runner.js'
import { maskToken, shapeConsoleErrors, shapeFailedRequests } from '../core/report.js'
import { UsageError } from '../core/usage.js'
import { AuthError } from '../core/auth.js'
import { ScenarioSchemaError } from '../scenario/schema.js'

export const SETTLE_MS = 800
export const DEFAULT_HEAD_CHARS = 600
export const MATCHED_TEXT_SLICE = 80
export const MESSAGE_SLICE = 120

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

const reasonFor = (e) => {
  if (e?.name === 'TimeoutError') return 'timeout'
  if (/intercept|outside of the viewport/i.test(e?.message ?? '')) return 'obscured'
  return 'error'
}

export function createTools({ manager, shotsDir = defaultShotsDir, settleMs = SETTLE_MS, load = loadScenario, run = runScenario } = {}) {
  const settle = (page) => page.waitForTimeout(settleMs)

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
        console_errors: shapeConsoleErrors(session.collectors.consoleErrors),
        failed_requests: shapeFailedRequests(session.collectors.failedRequests),
        degraded: degradedReasons.length > 0,
        ...(degradedReasons.length > 0 ? { degraded_reasons: degradedReasons } : {}),
      })
    },

    async guiClick(spec) {
      const { page } = manager.current()
      const audit = await clickAudit(locateAll(page, spec))
      let error = audit.matches === 0 ? 'not-found' : null
      let failureMessage
      if (error === null) {
        try {
          await clickLocator(page, spec).click({ timeout: CLICK_TIMEOUT_MS })
        } catch (e) {
          error = reasonFor(e)
          failureMessage = clipMessage(e)
        }
      }
      await settle(page)
      return json({
        ok: error === null,
        final_url: maskToken(page.url()),
        ...audit,
        ...(error !== null ? { error, message: failureMessage } : {}),
      })
    },

    async guiType({ into, text, locate } = {}) {
      if ((into !== undefined) === (locate !== undefined)) {
        throw new UsageError('BAD_TYPE_TARGET', 'into(CSS 选择器) 与 locate(text|role+name|selector) 必须二选一')
      }
      const { page } = manager.current()
      const full = locate !== undefined ? locateAll(page, locate) : page.locator(into)
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
      }
      await settle(page)
      return json({
        ok: error === null,
        final_url: maskToken(page.url()),
        ...audit,
        ...(error !== null ? { error, message: failureMessage } : {}),
      })
    },

    async guiShot({ name, outDir } = {}) {
      const { page } = manager.current()
      const dir = outDir !== undefined ? resolve(outDir) : shotsDir()
      mkdirSync(dir, { recursive: true })
      const path = join(dir, `${name}-${Date.now()}.png`)
      try {
        await page.screenshot({ path })
        return json({ ok: true, path })
      } catch (e) {
        return json({ ok: false, error: clipMessage(e) })
      }
    },

    async guiDom({ head = DEFAULT_HEAD_CHARS } = {}) {
      const { page } = manager.current()
      let full
      try {
        full = await page.locator('body').innerText({ timeout: 5000 })
      } catch (e) {
        return json({ ok: false, error: clipMessage(e) })
      }
      return json({
        ok: true,
        text: full.slice(0, head),
        total_length: full.length,
        truncated: full.length > head,
      })
    },

    async guiAssert({ asserts }) {
      const { page } = manager.current()
      const results = await runAsserts(page, asserts)
      return json({ ok: results.every(r => r.ok), results })
    },

    async guiRun({ scenario }) {
      const loaded = await load(scenario)
      const session = await manager.open({ target: loaded.target })
      const outDir = loaded.outDir !== undefined ? resolve(loaded.outDir) : shotsDir()
      mkdirSync(outDir, { recursive: true })
      // 隔离执行页:同 context(共享 cookie,不撞 chromium singleton 锁),不扰动交互会话页(issue #5)
      const page = await session.context.newPage()
      const collectors = createCollectors(page)
      await page.goto(session.baseUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {})
      const ctx = { baseUrl: session.baseUrl, outDir, timeoutScale: 1, shots: [], bodyText: null }
      try {
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
        })
      } finally {
        await page.close().catch(() => {})
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
