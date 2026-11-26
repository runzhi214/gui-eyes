import { resolveTarget, openSession } from '../core/session.js'
import { AuthError } from '../core/auth.js'

export const SPA_WAIT_MS = 6000
export const NO_SESSION_HINT = '无活动会话:先调用 gui_open 建立会话'

export class UsageError extends Error {
  constructor(code, hint) {
    super(code)
    this.code = code
    this.hint = hint
  }
}

export function createSessionManager({ open: openImpl = openSession, env = process.env, spaWaitMs = SPA_WAIT_MS } = {}) {
  let state = null

  const closeCurrent = async () => {
    if (!state) return
    const closing = state
    state = null
    await closing.context.close().catch(() => {})
  }

  const openOrReuse = async ({ target = 'dsh-web', baseUrl } = {}) => {
    const resolved = resolveTarget({ target, explicitBaseUrl: baseUrl, env })
    if (state && state.baseUrl === resolved.baseUrl && state.auth === resolved.auth) return state
    await closeCurrent()
    state = { ...resolved, ...(await openImpl({ target, explicitBaseUrl: baseUrl, env })) }
    await state.page.waitForTimeout(spaWaitMs)
    return state
  }

  return {
    async open(args) {
      return openOrReuse(args ?? {})
    },
    current() {
      if (!state) throw new UsageError('NO_SESSION', NO_SESSION_HINT)
      return state
    },
    async close() {
      await closeCurrent()
    },
  }
}

export { AuthError }
