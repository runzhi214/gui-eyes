import { existsSync, readFileSync } from 'node:fs'

export const AUTH_REQUIRED_TEXT = 'authentication required'
const PROBE_GOTO_TIMEOUT_MS = 20000
const PROBE_TEXT_TIMEOUT_MS = 5000
const RECAST_GOTO_TIMEOUT_MS = 20000

export const NO_TOKEN_HINT = '把 dsh web 终端里的完整 URL 写入 ~/.dsh-gui-token(一行)'
export const STALE_TOKEN_HINT = 'token 已失效(常见于 dsh 重启后轮换):把 dsh web 终端新打印的完整 URL 重贴到 ~/.dsh-gui-token(一行)'

export class AuthError extends Error {
  constructor(code, hint) {
    super(code)
    this.code = code
    this.hint = hint
  }
}

export function isAuthRequired(bodyText) {
  return bodyText.includes(AUTH_REQUIRED_TEXT)
}

export function readTokenUrl(files) {
  for (const file of files) {
    if (existsSync(file)) {
      const raw = readFileSync(file, 'utf8').trim()
      if (raw.startsWith('http')) return raw
    }
  }
  return null
}

const pageBodyText = (page) => page.locator('body').innerText({ timeout: PROBE_TEXT_TIMEOUT_MS }).catch(() => '')

export async function ensureDshCookieAuth({ page, baseUrl, tokenFiles }) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: PROBE_GOTO_TIMEOUT_MS }).catch(() => {})
  const bodyText = await pageBodyText(page)
  if (!isAuthRequired(bodyText)) return 'cookie'
  const tokenUrl = readTokenUrl(tokenFiles)
  if (tokenUrl === null) throw new AuthError('NO_TOKEN', NO_TOKEN_HINT)
  await page.goto(tokenUrl, { waitUntil: 'domcontentloaded', timeout: RECAST_GOTO_TIMEOUT_MS })
  // 兑付后复验(REQUIREMENTS §4.4 修订):token 死时兑付页仍是认证墙,不得报 token-bootstrap 假成功
  const afterText = await pageBodyText(page)
  if (isAuthRequired(afterText)) throw new AuthError('TOKEN_STALE', STALE_TOKEN_HINT)
  return 'token-bootstrap'
}
