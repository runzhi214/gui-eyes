import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { createSessionManager } from './session-manager.js'
import { AuthError } from '../core/auth.js'
import { UsageError } from '../core/usage.js'
import { ScenarioSchemaError } from '../scenario/schema.js'
import { createTools } from './tools.js'

// 安全事实(issue #8):GUI 操作以真实用户身份生效,不受会话权限模式约束
const SAFETY_NOTE = '注意:GUI 操作以真实用户身份生效,不受会话权限模式(只读/读写)约束'

const locateShape = z.object({
  text: z.string().optional(),
  role: z.string().optional(),
  name: z.string().optional(),
  selector: z.string().optional(),
  exact: z.boolean().optional(),
  frame: z.string().optional().describe('iframe 选择器;经 frameLocator 进入 iframe 后再定位'),
}).refine(s => {
  const hasText = s.text !== undefined
  const hasRole = s.role !== undefined && s.name !== undefined
  const hasSelector = s.selector !== undefined
  return [hasText, hasRole, hasSelector].filter(Boolean).length === 1
}, { message: '定位必须三选一: text | role+name | selector' })

const tabParam = z.number().int().min(0).optional()
  .describe('目标页索引(gui_open 报告的 tabs 总数;点击 target=_blank 弹出新页后用 tab 切换,如 tab:1)')

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
    description: `改完代码自己验证页面、验收 UI 改动或做回归检查时从这里开始。建立/复用浏览器会话并返回页面报告快照(标题/正文头/console 错误/失败请求含网络层/健康度 degraded/标签页数 tabs, token 掩码)。典型验证链: gui_open → gui_click/gui_type 交互 → gui_assert 断言 → gui_shot 截图留证。复用语义:同 baseUrl+auth 已有会话原样返回、不重新导航;页面已关闭或渲染崩溃自动重开;坏状态自救传 force: true。target: dsh-web 默认带 cookie 鉴权自动重铸; plain 采集任意 baseUrl(必填,不回退默认)。${SAFETY_NOTE}`,
    inputSchema: {
      target: z.enum(['dsh-web', 'plain']).optional().describe('dsh-web(默认) | plain'),
      baseUrl: z.string().optional().describe('覆盖 baseUrl(优先级最高;plain 必填)'),
      force: z.boolean().optional().describe('true=关闭旧会话强制重开(坏状态自救)'),
    },
  }, guarded(tools.guiOpen))

  server.registerTool('gui_click', {
    title: '点击页面元素',
    description: `验证/验收页面交互时点击元素(打开面板、切换视图、触发按钮),内置 800ms 渲染稳定等待。定位 text | role+name | selector 三选一(可选 frame 进入 iframe;可选 tab 指定标签页)。text 默认非精确子串匹配、多匹配时点 DOM 序第一个——响应的 matches 字段暴露命中数,歧义时换更精确的定位或 exact: true。失败时 error 分类: not-found / timeout / obscured / error。${SAFETY_NOTE}`,
    inputSchema: locateShape.extend({ tab: tabParam }),
  }, guarded(tools.guiClick))

  server.registerTool('gui_type', {
    title: '输入文本',
    description: `验证表单/搜索交互时向输入框填入文本,内置 800ms 稳定等待。定位二选一: into(CSS 选择器)或 locate(text|role+name|selector,与点击同构,支持 frame/tab)。已知坑: fill 实现对富文本编辑器(ProseMirror 类)清空无效——不要用空串清空,填入替换内容。${SAFETY_NOTE}`,
    inputSchema: z.object({
      into: z.string().optional().describe('CSS 选择器(与 locate 二选一)'),
      locate: locateShape.optional().describe('text|role+name|selector 定位(与 into 二选一)'),
      text: z.string().describe('要输入的文本'),
      tab: tabParam,
    }).refine(s => (s.into !== undefined) !== (s.locate !== undefined), { message: 'into 与 locate 必须二选一' }),
  }, guarded(tools.guiType))

  server.registerTool('gui_shot', {
    title: '截图',
    description: `页面改动验收/回归留证用截图。截当前页面,PNG 落 shots/<今日>/ 目录(可用 outDir 覆盖),返回绝对路径(可直接交给读图工具);fullPage: true 含视口外整页(默认 false 仅视口);失败时不返回 path,附 error。${SAFETY_NOTE}`,
    inputSchema: {
      name: z.string().describe('文件名前缀'),
      outDir: z.string().optional().describe('截图目录(相对路径按引擎仓解析;默认 shots/<今日>/)'),
      fullPage: z.boolean().optional().describe('true=整页截图(含视口外)'),
      tab: tabParam,
    },
  }, guarded(tools.guiShot))

  server.registerTool('gui_dom', {
    title: '读页面正文',
    description: `验证/检查页面文本内容时读取。读当前页面 body innerText 头部(默认 2000 字符,head 可调),附 total_length 与 truncated 标记,可区分空文与截断;读取失败返回 ok:false。能力边界: 仅主文档 innerText——不含 iframe 内文本(用 gui_assert 的 frame 定位或 gui_click 带 frame)与 Shadow DOM 文本(textVisible 断言可穿透 shadow);新标签页需先 tab 参数。${SAFETY_NOTE}`,
    inputSchema: {
      head: z.number().int().positive().optional().describe('截取字符数,默认 2000'),
      tab: tabParam,
    },
  }, guarded(tools.guiDom))

  server.registerTool('gui_assert', {
    title: '断言',
    description: `页面验证/验收的核心:对当前会话页面逐条执行断言 textVisible | textNotVisible | attrMatches | count | textMatches | checked(单键 {rule: arg};规则对象可选 frame 进入 iframe、text 可用 {text, frame} 形态)。textVisible 与点击同口径(getByText 穿透 open shadow、只计可见元素、子串大小写不敏感);定位器执行异常按「执行异常」失败,不与计数 0 混同。${SAFETY_NOTE}`,
    inputSchema: {
      asserts: z.array(z.record(z.string(), z.unknown())).min(1).describe('断言项数组,单键 {rule: arg} 形状'),
      tab: tabParam,
    },
  }, guarded(tools.guiAssert))

  server.registerTool('gui_run', {
    title: '跑场景文件',
    description: `回归测试一个 YAML 场景(steps+asserts 全链,适合反复跑的验证流)。在独立页面执行(同 context 共享 cookie,不扰动交互会话页;场景 target 与当前会话不同时会切换底层会话),返回步骤摘要(失败步骤附 message 原因)、逐条断言、截图路径、正文头与失败请求观测(含网络层)。${SAFETY_NOTE}`,
    inputSchema: { scenario: z.string().describe('场景 YAML 绝对路径') },
  }, guarded(tools.guiRun))

  return server
}

export { UsageError, AuthError, ScenarioSchemaError }
