import { mkdirSync } from 'node:fs'
import { TARGETS, VIEWPORT, profileDir, tokenFilePaths, resolveBaseUrl } from './config.js'
import { launchBrowserContext, firstPage } from './browser.js'
import { ensureDshCookieAuth } from './auth.js'
import { createCollectors } from './observe.js'
import { UsageError, PLAIN_BASE_URL_HINT } from './usage.js'

export function resolveTarget({ target = 'dsh-web', explicitBaseUrl, env = process.env } = {}) {
  const declared = typeof target === 'string' ? TARGETS[target] : target
  const baseUrl = resolveBaseUrl({ explicit: explicitBaseUrl, env, targetDeclared: declared?.baseUrl })
  const auth = declared?.auth ?? 'dsh-cookie'
  // baseUrlExplicit: baseUrl 是否来自显式来源(参数/环境变量/内联声明),plain 目标据此拒绝静默回退
  const baseUrlExplicit = explicitBaseUrl !== undefined || env.GUI_EYES_BASE_URL !== undefined || declared?.baseUrl !== undefined
  return { baseUrl, auth, baseUrlExplicit }
}

export async function openSession({ target, explicitBaseUrl, env, viewport, headless = true, launch } = {}) {
  const { baseUrl, auth, baseUrlExplicit } = resolveTarget({ target, explicitBaseUrl, env })
  // plain 采集目标必须显式给 baseUrl:静默落到 dsh-web 默认地址违背「任意 web GUI」定位(issue #6)
  if (auth === 'none' && !baseUrlExplicit) throw new UsageError('PLAIN_BASE_URL_MISSING', PLAIN_BASE_URL_HINT)
  mkdirSync(profileDir(), { recursive: true })
  const context = await launchBrowserContext({ profileDir: profileDir(), viewport: viewport ?? VIEWPORT, headless, launch })
  const page = await firstPage(context)
  const collectors = createCollectors(page)
  let authMode
  if (auth === 'dsh-cookie') {
    authMode = await ensureDshCookieAuth({ page, baseUrl, tokenFiles: tokenFilePaths() })
  } else {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {})
    authMode = 'none'
  }
  return { context, page, collectors, authMode, baseUrl }
}
