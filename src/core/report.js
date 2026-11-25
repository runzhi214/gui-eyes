const TOKEN_PATTERN = /token=[^&\s']*/g

export const maskToken = (s) => s.replace(TOKEN_PATTERN, 'token=***')

export const shapeConsoleErrors = (errors) => errors.slice(0, 10)
export const shapeFailedRequests = (requests) => requests.slice(0, 15)

export function exitCodeFor({ authError, failure, assertsFailed } = {}) {
  if (authError) return 2
  if (failure || assertsFailed) return 1
  return 0
}
