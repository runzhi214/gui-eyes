import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { clickLocator } from '../core/primitives.js'
import { runAsserts } from '../core/asserts.js'
import { loadScenario } from '../scenario/load.js'
import { runScenario } from '../scenario/runner.js'
import { maskToken } from '../core/report.js'
import { UsageError, AuthError } from './session-manager.js'
import { ScenarioSchemaError } from '../scenario/schema.js'

export const SETTLE_MS = 800
export const DEFAULT_HEAD_CHARS = 600

// 截图默认落引擎仓 shots/(绝对路径,agent 拿到即可 read_image)
const REPO_ROOT = resolve(join(fileURLToPath(import.meta.url), '../../..'))
export const defaultShotsDir = () => join(REPO_ROOT, 'shots')

const bodyText = (page) => page.locator('body').innerText({ timeout: 5000 }).catch(() => '')

export function createTools({ manager, shotsDir = defaultShotsDir, settleMs = SETTLE_MS, load = loadScenario, run = runScenario } = {}) {
  const settle = (page) => page.waitForTimeout(settleMs)

  return {
    async guiOpen({ target, baseUrl }) {
      const session = await manager.open({ target, baseUrl })
      const report = {
        auth_mode: session.authMode,
        final_url: maskToken(session.page.url()),
        title: await session.page.title().catch(() => ''),
        body_text_head: (await bodyText(session.page)).slice(0, DEFAULT_HEAD_CHARS),
        console_errors: session.collectors.consoleErrors.slice(0, 10),
        failed_requests: session.collectors.failedRequests.slice(0, 15),
      }
      return { content: [{ type: 'text', text: JSON.stringify(report) }] }
    },

    async guiClick(spec) {
      const { page } = manager.current()
      const locator = clickLocator(page, spec)
      const ok = await locator.click({ timeout: 8000 }).then(() => true).catch(() => false)
      await settle(page)
      return { content: [{ type: 'text', text: JSON.stringify({ ok, final_url: maskToken(page.url()) }) }] }
    },

    async guiType({ into, text }) {
      const { page } = manager.current()
      const ok = await page.locator(into).first().fill(text, { timeout: 8000 }).then(() => true).catch(() => false)
      await settle(page)
      return { content: [{ type: 'text', text: JSON.stringify({ ok, final_url: maskToken(page.url()) }) }] }
    },

    async guiShot({ name }) {
      const { page } = manager.current()
      const dir = shotsDir()
      mkdirSync(dir, { recursive: true })
      const path = join(dir, `${name}-${Date.now()}.png`)
      const ok = await page.screenshot({ path }).then(() => true).catch(() => false)
      return { content: [{ type: 'text', text: JSON.stringify({ ok, path }) }] }
    },

    async guiDom({ head = DEFAULT_HEAD_CHARS } = {}) {
      const { page } = manager.current()
      const text = (await bodyText(page)).slice(0, head)
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, text }) }] }
    },

    async guiAssert({ asserts }) {
      const { page } = manager.current()
      const results = await runAsserts(page, asserts)
      return { content: [{ type: 'text', text: JSON.stringify({ ok: results.every(r => r.ok), results }) }] }
    },

    async guiRun({ scenario }) {
      const loaded = await load(scenario)
      const session = await manager.open({ target: loaded.target })
      const outDir = loaded.outDir !== undefined ? resolve(loaded.outDir) : shotsDir()
      mkdirSync(outDir, { recursive: true })
      const ctx = { baseUrl: session.baseUrl, outDir, timeoutScale: 1, shots: [], bodyText: null }
      const { steps, asserts } = await run(session.page, loaded, ctx)
      const ok = steps.every(s => s.ok) && asserts.every(a => a.ok)
      return { content: [{ type: 'text', text: JSON.stringify({ ok, steps, asserts, shots: ctx.shots }) }] }
    },

    // 统一错误面:UsageError/AuthError/SchemaError → 结构化 isError;未知错误原样抛给 SDK
    wrapError(error) {
      if (error instanceof UsageError || error instanceof AuthError) {
        return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: error.code, hint: error.hint }) }] }
      }
      if (error instanceof ScenarioSchemaError) {
        return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: 'INVALID_SCENARIO', errors: error.errors }) }] }
      }
      return null
    },
  }
}
