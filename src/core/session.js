import { mkdirSync } from 'node:fs'
import { TARGETS, VIEWPORT, profileDir, tokenFilePaths, resolveBaseUrl } from './config.js'
import { launchBrowserContext, firstPage } from './browser.js'
import { ensureDshCookieAuth } from './auth.js'
import { createCollectors } from './observe.js'

export function resolveTarget({ target = 'dsh-web', explicitBaseUrl, env = process.env } = {}) {
  const declared = typeof target === 'string' ? TARGETS[target] : target
  const baseUrl = resolveBaseUrl({ explicit: explicitBaseUrl, env, targetDeclared: declared?.baseUrl })
  const auth = declared?.auth ?? 'dsh-cookie'
  return { baseUrl, auth }
}

export async function openSession({ target, explicitBaseUrl, env, viewport, headless = true, launch } = {}) {
  const { baseUrl, auth } = resolveTarget({ target, explicitBaseUrl, env })
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
