import { runStep } from '../core/primitives.js'
import { runAssertEntry } from '../core/asserts.js'

export async function runScenario(page, scenario, ctx) {
  const steps = []
  const asserts = []
  for (const entry of scenario.steps) {
    const [action] = Object.keys(entry)
    if (action === 'assert') {
      asserts.push(await runAssertEntry(page, entry.assert))
      continue
    }
    try {
      await runStep(page, entry, ctx)
      steps.push({ action, arg: entry[action], ok: true })
    } catch (e) {
      steps.push({ action, arg: entry[action], ok: false })
    }
  }
  for (const entry of scenario.asserts) {
    asserts.push(await runAssertEntry(page, entry))
  }
  if (ctx.bodyText === null) ctx.bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')
  return { steps, asserts }
}
