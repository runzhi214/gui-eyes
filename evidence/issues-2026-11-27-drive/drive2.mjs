// #27/#29 活体 drive(2026-11-27): 真 chromium 验证 strict 停跑语义与 engine_version 尾字段。
// 复现: node evidence/issues-2026-11-27-drive/drive2.mjs
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { runScenario } from '../../src/scenario/runner.js'
import { createSessionManager } from '../../src/server/session-manager.js'
import { createTools } from '../../src/server/tools.js'

const parse = (r) => JSON.parse(r.content[0].text)
const dir = mkdtempSync(join(tmpdir(), 'gui-eyes-drive2-'))
const out = { steps: [] }
const record = (name, r) => { out.steps.push({ name, ...r }) }

// #27: strict 场景——第三步 click 不存在的文本,之后还有步骤与后置断言
const browser = await chromium.launch({ headless: true })
const pg = await browser.newPage()
await pg.goto('data:text/html,<h1>主文档</h1>')
const ctx = { baseUrl: 'http://x/', outDir: dir, timeoutScale: 1, shots: [], bodyText: null }
const result = await runScenario(pg, { name: 'strict-demo', strict: true, steps: [
  { wait: 10 },
  { click: { selector: 'h1' } },          // 成功
  { click: { selector: '#nope' } },        // 失败 -> strict 停跑
  { wait: 20 },                            // 不应执行
], asserts: [{ textVisible: '主文档' }] }, ctx) // 后置断言不应执行
record('strict 停跑', {
  stopped_at: result.stopped_at,
  step_count: result.steps.length,
  post_asserts_ran: result.asserts.length,
})
// 对照: 非 strict 同场景全量执行
const result2 = await runScenario(pg, { name: 'loose-demo', steps: [
  { wait: 10 }, { click: { selector: '#nope' } }, { wait: 20 },
], asserts: [{ textVisible: '主文档' }] }, ctx)
record('缺省 catch-continue 对照', {
  stopped_at_absent: result2.stopped_at === undefined,
  step_count: result2.steps.length,
  post_asserts_ran: result2.asserts.length,
})
await browser.close()

// #29: 引擎工具响应带 engine_version(驱动真实 tools 面)
const pageHtml = `<h1>驱2页</h1>`
const pagePath = join(dir, 'd.html')
writeFileSync(pagePath, pageHtml)
const manager = createSessionManager()
const tools = createTools({ manager, shotsDir: () => dir })
await manager.open({ target: 'plain', baseUrl: `file://${pagePath}` })
const dom = parse(await tools.guiDom({ head: 100 }))
record('engine_version 尾字段', { engine_version: dom.engine_version, text_has: dom.text.includes('驱2页') })
await manager.close()
rmSync(dir, { recursive: true, force: true })

const report = JSON.stringify(out, null, 2)
console.log(report)
writeFileSync(new URL('./drive2.json', import.meta.url), report + '\n')
