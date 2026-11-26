export class UsageError extends Error {
  constructor(code, hint) {
    super(code)
    this.code = code
    this.hint = hint
  }
}

export const NO_SESSION_HINT = '无活动会话:先调用 gui_open 建立会话'
export const PLAIN_BASE_URL_HINT = 'plain 目标需要显式 baseUrl(参数或 GUI_EYES_BASE_URL),不会回退到 dsh-web 默认地址'
