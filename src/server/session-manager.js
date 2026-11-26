import { resolveTarget, openSession } from '../core/session.js'
import { UsageError, NO_SESSION_HINT } from '../core/usage.js'

export const SPA_WAIT_MS = 6000

// 明确死信号才自动重开;「上次报告 degraded」不自动重开(合法空白页会误杀),留给 agent 带 force 自救
const deadReason = (state) => {
  if (state.page.isClosed()) return '旧页面已关闭'
  if (state.collectors.crashCount() > 0) return '页面渲染进程崩溃'
  return null
}

export function createSessionManager({ open: openImpl = openSession, env = process.env, spaWaitMs = SPA_WAIT_MS } = {}) {
  let state = null

  const closeCurrent = async () => {
    if (!state) return
    const closing = state
    state = null
    await closing.context.close().catch(() => {})
  }

  const openOrReuse = async ({ target = 'dsh-web', baseUrl, force } = {}) => {
    const resolved = resolveTarget({ target, explicitBaseUrl: baseUrl, env })
    const reusable = !force && state && state.baseUrl === resolved.baseUrl && state.auth === resolved.auth
    if (reusable && deadReason(state) === null) return state
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
