import { chromium } from 'playwright'

export const LAUNCH_PLANS = [
  { label: 'bundled-chromium', options: {} },
  { label: 'chrome-channel', options: { channel: 'chrome' } },
]

// 启动自愈指引(#28): 双 plan 皆败且报错指向浏览器缺失时,附上可执行的自愈路径。
// 版本钉死事实如实陈述(不假称可自动下载): 引擎钉 playwright 1.62.1 → chromium-1234。
export const LAUNCH_SELF_HEAL_HINT = [
  '自愈指引: 本引擎钉死 playwright 1.62.1(需 chromium-1234)。',
  '(1) 安装对应版本 chromium: npx playwright@1.62.1 install chromium;',
  '国内网络先 export PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright/;',
  '(2) 或确保本机装有 Google Chrome——启动会自动兜底 channel:"chrome"。',
].join(' ')

const MISSING_BROWSER_PATTERN = /Executable doesn't exist|Failed to launch (the )?(browser|chrome)|chrome.*ENOENT/i

function withSelfHeal(error) {
  try {
    const msg = String(error?.message ?? error)
    if (MISSING_BROWSER_PATTERN.test(msg) && !msg.includes('自愈指引')) {
      error.message = `${msg}\n${LAUNCH_SELF_HEAL_HINT}`
    }
  } catch { /* message 只读等极端形态:原样抛出 */ }
  return error
}

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
  throw withSelfHeal(lastError)
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
  throw withSelfHeal(lastError)
}
