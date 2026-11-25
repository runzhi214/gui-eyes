import { chromium } from 'playwright'

export const LAUNCH_PLANS = [
  { label: 'bundled-chromium', options: {} },
  { label: 'chrome-channel', options: { channel: 'chrome' } },
]

const defaultLaunch = ({ profileDir, headless, viewport, ...options }) =>
  chromium.launchPersistentContext(profileDir, { headless, viewport, ...options })

export async function launchBrowserContext({ profileDir, viewport, headless = true, launch = defaultLaunch } = {}) {
  let lastError
  for (const plan of LAUNCH_PLANS) {
    try {
      return await launch({ profileDir, headless, viewport, ...plan.options })
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

export async function firstPage(context) {
  return context.pages()[0] ?? (await context.newPage())
}
