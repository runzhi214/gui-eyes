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
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, consoleSlice))
  })
  page.on('response', (r) => {
    const entry = failedRequestEntry({ status: r.status(), url: r.url() })
    if (entry) failedRequests.push(entry)
  })
  return { consoleErrors, failedRequests }
}
