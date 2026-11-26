import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { createSessionManager, UsageError, AuthError } from './session-manager.js'
import { createTools } from './tools.js'
import { ScenarioSchemaError } from '../scenario/schema.js'

const clickShape = z.object({
  text: z.string().optional(),
  role: z.string().optional(),
  name: z.string().optional(),
  selector: z.string().optional(),
  exact: z.boolean().optional(),
}).refine(s => {
  const hasText = s.text !== undefined
  const hasRole = s.role !== undefined && s.name !== undefined
  const hasSelector = s.selector !== undefined
  return [hasText, hasRole, hasSelector].filter(Boolean).length === 1
}, { message: 'click 必须三选一: text | role+name | selector' })

export function createMcpServer({ manager = createSessionManager(), tools = createTools({ manager }) } = {}) {
  const server = new McpServer({ name: 'gui-eyes', version: '0.1.0' })
  const guarded = (handler) => async (args) => {
    try {
      return await handler(args)
    } catch (e) {
      const shaped = tools.wrapError(e)
      if (shaped) return shaped
      throw e
    }
  }

  server.registerTool('gui_open', {
    title: '打开或复用 GUI 会话',
    description: '建立/复用浏览器会话(target: dsh-web 默认带 cookie 鉴权自动重铸; plain 采集任意 baseUrl)并返回页面报告快照(标题/正文头/console 错误/失败请求, token 掩码)。',
    inputSchema: {
      target: z.enum(['dsh-web', 'plain']).optional().describe('dsh-web(默认) | plain'),
      baseUrl: z.string().optional().describe('覆盖 baseUrl(优先级高于环境变量与默认)'),
    },
  }, guarded(tools.guiOpen))

  server.registerTool('gui_click', {
    title: '点击页面元素',
    description: '按 text | role+name | selector 三选一点击当前会话页面元素,内置 800ms 渲染稳定等待。',
    inputSchema: clickShape,
  }, guarded(tools.guiClick))

  server.registerTool('gui_type', {
    title: '输入文本',
    description: '向选择器定位的输入框填入文本,内置 800ms 稳定等待。',
    inputSchema: {
      into: z.string().describe('CSS 选择器'),
      text: z.string().describe('要输入的文本'),
    },
  }, guarded(tools.guiType))

  server.registerTool('gui_shot', {
    title: '截图',
    description: '截当前页面,PNG 落引擎仓 shots/ 目录,返回绝对路径(可直接交给读图工具)。',
    inputSchema: { name: z.string().describe('文件名前缀') },
  }, guarded(tools.guiShot))

  server.registerTool('gui_dom', {
    title: '读页面正文',
    description: '读当前页面 body innerText 头部(head 可调,默认 600 字符)。',
    inputSchema: { head: z.number().int().positive().optional().describe('截取字符数,默认 600') },
  }, guarded(tools.guiDom))

  server.registerTool('gui_assert', {
    title: '断言',
    description: '对当前会话页面逐条执行断言: textVisible | textNotVisible | attrMatches | count | textMatches | checked(形状同场景 YAML assert 项)。',
    inputSchema: {
      asserts: z.array(z.record(z.string(), z.unknown())).min(1).describe('断言项数组,单键 {rule: arg} 形状'),
    },
  }, guarded(tools.guiAssert))

  server.registerTool('gui_run', {
    title: '跑场景文件',
    description: '装载并执行一个场景 YAML(steps+asserts 全链),返回步骤摘要、逐条断言与截图路径。',
    inputSchema: { scenario: z.string().describe('场景 YAML 绝对路径') },
  }, guarded(tools.guiRun))

  return server
}

export { UsageError, AuthError, ScenarioSchemaError }
