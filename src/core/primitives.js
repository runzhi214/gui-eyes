import { join } from 'node:path'

export const CLICK_TIMEOUT_MS = 8000
export const TYPE_TIMEOUT_MS = 8000
export const GOTO_TIMEOUT_MS = 20000

const resolveUrl = (baseUrl, path) => (/^https?:\/\//.test(path) ? path : new URL(path, baseUrl).href)

export function clickLocator(page, spec) {
  if (typeof spec === 'string') return page.getByText(spec).first()
  if (spec.text !== undefined) return page.getByText(spec.text, { exact: spec.exact === true }).first()
  if (spec.role !== undefined) return page.getByRole(spec.role, { name: spec.name }).first()
  return page.locator(spec.selector).first()
}

async function bodyInnerText(page) {
  return page.locator('body').innerText({ timeout: 5000 }).catch(() => '')
}

export async function runStep(page, entry, ctx) {
  const [action] = Object.keys(entry)
  const arg = entry[action]
  switch (action) {
    case 'goto':
      await page.goto(resolveUrl(ctx.baseUrl, arg), { waitUntil: 'domcontentloaded', timeout: GOTO_TIMEOUT_MS * ctx.timeoutScale })
      return
    case 'wait':
      await page.waitForTimeout(arg * ctx.timeoutScale)
      return
    case 'click': {
      if (arg.ifNotVisible !== undefined) {
        const body = await bodyInnerText(page)
        if (body.includes(arg.ifNotVisible)) return
      }
      await clickLocator(page, arg).click({ timeout: CLICK_TIMEOUT_MS * ctx.timeoutScale })
      return
    }
    case 'type':
      await page.locator(arg.into).first().fill(arg.text, { timeout: TYPE_TIMEOUT_MS * ctx.timeoutScale })
      return
    case 'shot': {
      const path = join(ctx.outDir, `${arg}-${Date.now()}.png`)
      await page.screenshot({ path })
      ctx.shots.push(path)
      return
    }
    case 'dom':
      ctx.bodyText = await bodyInnerText(page)
      return
    default:
      throw new Error(`unknown step action "${action}"`)
  }
}
