import { runStep } from '../core/primitives.js'
import { runAssertEntry } from '../core/asserts.js'

const MESSAGE_SLICE = 120

export async function runScenario(page, scenario, ctx) {
  const steps = []
  const asserts = []
  let stoppedAt = null
  const entries = scenario.steps.entries()
  for (const [index, entry] of entries) {
    const [action] = Object.keys(entry)
    if (action === 'assert') {
      asserts.push(await runAssertEntry(page, entry.assert))
      continue
    }
    try {
      await runStep(page, entry, ctx)
      steps.push({ action, arg: entry[action], ok: true })
    } catch (e) {
      // 失败原因不丢弃(issue #10): 与 MCP 交互路径的 error/message 口径对齐,级联失效显式可见
      steps.push({ action, arg: entry[action], ok: false, message: String(e?.message ?? e).slice(0, MESSAGE_SLICE) })
      // strict(#27): 遇第一个失败步骤即停——后续步骤与断言不对坏页面级联,报告标 stopped_at 让停点显式
      if (scenario.strict === true) {
        stoppedAt = index
        break
      }
    }
  }
  if (stoppedAt === null) {
    for (const entry of scenario.asserts) {
      asserts.push(await runAssertEntry(page, entry))
    }
  }
  if (ctx.bodyText === null) ctx.bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')
  return { steps, asserts, ...(stoppedAt !== null ? { stopped_at: stoppedAt } : {}) }
}
