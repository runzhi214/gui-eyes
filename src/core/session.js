import { mkdirSync } from 'node:fs'
import { TARGETS, VIEWPORT, profileDir, tokenFilePaths, resolveBaseUrl, httpCredentialsFromEnv, storageStateFromEnv, launchOptionsFromEnv } from './config.js'
import { launchBrowserContext, firstPage } from './browser.js'
import { ensureDshCookieAuth } from './auth.js'
import { createCollectors } from './observe.js'
import { UsageError, PLAIN_BASE_URL_HINT } from './usage.js'

export function resolveTarget({ target = 'dsh-web', explicitBaseUrl, env = process.env } = {}) {
  const declared = typeof target === 'string' ? TARGETS[target] : target
  // 内联声明(target 对象写的 baseUrl)优先于 env;注册表地址只是缺省,不算声明(issue #11)
  const inlineDeclared = typeof target === 'object' && target !== null ? target.baseUrl : undefined
  const baseUrl = resolveBaseUrl({ explicit: explicitBaseUrl, env, inlineDeclared, fallback: declared?.baseUrl })
  const auth = declared?.auth ?? 'dsh-cookie'
  const baseUrlExplicit = explicitBaseUrl !== undefined || env.GUI_EYES_BASE_URL !== undefined || inlineDeclared !== undefined
  return { baseUrl, auth, baseUrlExplicit }
}

export async function openSession({ target, explicitBaseUrl, env, viewport, headless = true, launch } = {}) {
  const { baseUrl, auth, baseUrlExplicit } = resolveTarget({ target, explicitBaseUrl, env })
  // plain 采集目标必须显式给 baseUrl:静默落到 dsh-web 默认地址违背「任意 web GUI」定位(issue #6)
  if (auth === 'none' && !baseUrlExplicit) throw new UsageError('PLAIN_BASE_URL_MISSING', PLAIN_BASE_URL_HINT)
  const httpCredentials = httpCredentialsFromEnv(env)
  const launchOptions = launchOptionsFromEnv(env)
  mkdirSync(profileDir(auth), { recursive: true })
  const context = await launchBrowserContext({
    profileDir: profileDir(auth), viewport: viewport ?? VIEWPORT, headless,
    httpCredentials, launch, ...launchOptions,
  })
  const page = await firstPage(context)
  const collectors = createCollectors(page)
  let authMode
  if (auth === 'dsh-cookie') {
    authMode = await ensureDshCookieAuth({ page, baseUrl, tokenFiles: tokenFilePaths() })
  } else {
    // storageState 导入(#25): 仅 plain 通道——dsh-web 的 cookie 引擎自管,不叠加外来态
    const storage = storageStateFromEnv(env)
    if (storage !== undefined) {
      if (storage.cookies.length > 0) await context.addCookies(storage.cookies)
      if (storage.origins.length > 0) {
        // addInitScript 每次导航前按 origin 水合 localStorage(evaluate 同规:只收一个额外参数,打包传递)
        await context.addInitScript((payload) => {
          for (const origin of payload.origins) {
            if (location.origin !== origin.origin) continue
            for (const item of origin.localStorage ?? []) localStorage.setItem(item.name, item.value)
          }
        }, { origins: storage.origins })
      }
    }
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {})
    authMode = 'none'
  }
  return { context, page, collectors, authMode, baseUrl }
}
