import { maskToken } from './report.js'

export const CONSOLE_ERROR_SLICE = 300
const FAILED_REQUEST_API_SLICE = 120
const API_PATH_MARK = '/api/'

export function failedRequestEntry({ status, url }) {
  if (status < 400) return null
  const masked = maskToken(url)
  if (!masked.includes(API_PATH_MARK)) return `HTTP ${status} ${masked}`
  return `HTTP ${status} ${masked.slice(0, FAILED_REQUEST_API_SLICE)}`
}

export function createCollectors(page, { consoleSlice = CONSOLE_ERROR_SLICE } = {}) {
  const consoleErrors = []
  const failedRequests = []
  const inFlight = new Map()
  let crashes = 0
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, consoleSlice))
  })
  page.on('response', (r) => {
    const entry = failedRequestEntry({ status: r.status(), url: r.url() })
    if (entry) failedRequests.push(entry)
  })
  // 网络层失败(issue #10): DNS 失败/连接拒绝/证书错误不产生 response 事件,必须有独立观测
  page.on('requestfailed', (r) => {
    failedRequests.push(`NET ${r.failure()?.errorText ?? 'unknown'} ${maskToken(r.url())}`)
    inFlight.delete(r)
  })
  // in-flight 跟踪(issue #14): 发起后既未 finished 也未 failed 的请求 = 挂起可归因,不再伪装成断言失败
  page.on('request', (r) => { inFlight.set(r, r.url()) })
  page.on('requestfinished', (r) => { inFlight.delete(r) })
  page.on('crash', () => { crashes += 1 })
  return {
    consoleErrors,
    failedRequests,
    crashCount: () => crashes,
    pendingRequests: () => [...inFlight.values()].map(maskToken),
  }
}
