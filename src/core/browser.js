import { chromium } from 'playwright'

export const LAUNCH_PLANS = [
  { label: 'bundled-chromium', options: {} },
  { label: 'chrome-channel', options: { channel: 'chrome' } },
]

const defaultLaunch = ({ profileDir, headless, viewport, httpCredentials, ...options }) =>
  chromium.launchPersistentContext(profileDir, { headless, viewport, ...(httpCredentials !== undefined ? { httpCredentials } : {}), ...options })

export async function launchBrowserContext({ profileDir, viewport, headless = true, httpCredentials, launch = defaultLaunch } = {}) {
  let lastError
  for (const plan of LAUNCH_PLANS) {
    try {
      return await launch({ profileDir, headless, viewport, httpCredentials, ...plan.options })
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

export async function firstPage(context) {
  return context.pages()[0] ?? (await context.newPage())
}

// 临时浏览器(issue #14 根治): 非持久化实例与持久 profile 并存不占锁,
// 连接池/存储与交互会话彻底隔离;storageState 由调用方注入(30 天 cookie 随行)。
const defaultEphemeralLaunch = ({ headless, viewport, ...options }) =>
  chromium.launch({ headless, ...options })

export async function launchEphemeralBrowser({ headless = true, viewport, httpCredentials, launch = defaultEphemeralLaunch } = {}) {
  let lastError
  for (const plan of LAUNCH_PLANS) {
    try {
      const browser = await launch({ headless, viewport, httpCredentials, ...plan.options })
      return browser
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}
