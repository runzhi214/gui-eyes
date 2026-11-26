import { homedir } from 'node:os'
import { join } from 'node:path'
import { UsageError } from './usage.js'

export const DEFAULT_BASE_URL = 'http://127.0.0.1:3080/'
export const VIEWPORT = { width: 1440, height: 900 }

export const TARGETS = {
  'dsh-web': { baseUrl: DEFAULT_BASE_URL, auth: 'dsh-cookie' },
  plain: { auth: 'none' },
}

export const tokenFilePaths = () => [join(homedir(), '.dsh-gui-token'), '/tmp/dsh-gui-token']

// profile 按鉴权级别拆分(issue #11): dsh 30 天鉴权 cookie 与任意采集站点不共用浏览器上下文
export const profileDir = (auth = 'dsh-cookie') =>
  auth === 'dsh-cookie'
    ? join(homedir(), '.cache/dsh-gui-eyes/profile')
    : join(homedir(), '.cache/dsh-gui-eyes/profile-plain')

// baseUrl 优先级(2026-11-26 issue#11 契约修订): 显式参数 > 场景内联声明 > 环境变量 > 内置默认。
// 场景作者写的内联地址不被 ambient env 静默劫持;未声明时 env 仍可重定向运行。
export function resolveBaseUrl({ explicit, env = process.env, inlineDeclared, fallback = DEFAULT_BASE_URL } = {}) {
  if (explicit) return explicit
  if (inlineDeclared) return inlineDeclared
  if (env.GUI_EYES_BASE_URL) return env.GUI_EYES_BASE_URL
  return fallback
}

// GUI_EYES_HTTP_CREDS=user:pass → httpCredentials(凭据经环境传入,不进 MCP 参数与会话日志)
export function httpCredentialsFromEnv(env = process.env) {
  const raw = env.GUI_EYES_HTTP_CREDS
  if (raw === undefined) return undefined
  const i = raw.indexOf(':')
  if (i <= 0) throw new UsageError('BAD_HTTP_CREDS', 'GUI_EYES_HTTP_CREDS 必须为 user:pass 形式')
  return { username: raw.slice(0, i), password: raw.slice(i + 1) }
}

// GUI_EYES_LAUNCH_JSON='{"ignoreHTTPSErrors":true,...}' → 白名单透传浏览器启动参数
export const LAUNCH_OPTION_KEYS = ['ignoreHTTPSErrors', 'proxy', 'userAgent', 'locale']
export function launchOptionsFromEnv(env = process.env) {
  const raw = env.GUI_EYES_LAUNCH_JSON
  if (!raw) return {}
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new UsageError('BAD_LAUNCH_JSON', 'GUI_EYES_LAUNCH_JSON 不是合法 JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new UsageError('BAD_LAUNCH_JSON', 'GUI_EYES_LAUNCH_JSON 必须为 JSON 对象')
  }
  return Object.fromEntries(LAUNCH_OPTION_KEYS.filter(k => parsed[k] !== undefined).map(k => [k, parsed[k]]))
}
