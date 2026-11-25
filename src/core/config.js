import { homedir } from 'node:os'
import { join } from 'node:path'

export const DEFAULT_BASE_URL = 'http://127.0.0.1:3080/'
export const VIEWPORT = { width: 1440, height: 900 }

export const TARGETS = {
  'dsh-web': { baseUrl: DEFAULT_BASE_URL, auth: 'dsh-cookie' },
  plain: { auth: 'none' },
}

export const tokenFilePaths = () => [join(homedir(), '.dsh-gui-token'), '/tmp/dsh-gui-token']
export const profileDir = () => join(homedir(), '.cache/dsh-gui-eyes/profile')

export function resolveBaseUrl({ explicit, env = process.env, targetDeclared } = {}) {
  if (explicit) return explicit
  if (env.GUI_EYES_BASE_URL) return env.GUI_EYES_BASE_URL
  if (targetDeclared) return targetDeclared
  return DEFAULT_BASE_URL
}
