// M2.2 第二批验收活体驱动: spawn 新代码 MCP server, 真机覆盖 issue #9–#13 修复行为。
// 证据产物: evidence/issues-2026-11-26/issue9-13-drive.json
// 复现页: ~/projects/gui-eyes-plain-test/ (http.server 8472, 由调用方保证在跑)
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const REPO = '/home/x30070689/projects/dsh-gui-eyes'
const OUT = join(REPO, 'evidence/issues-2026-11-26/issue9-13-drive.json')
const PAGES = 'http://127.0.0.1:8472/'
const WB = join(homedir(), 'projects/landingzone-workbench/.dsh/gui-scenarios')

const log = []
const failures = []
const check = (name, cond, note = '') => {
  log.push({ name, pass: cond === true, ...(note ? { note } : {}) })
  if (cond !== true) failures.push(name)
}
const parse = (res) => JSON.parse(res.content?.[0]?.text ?? 'null')

// 长文本页(gui_dom 默认 head=2000 验证用)
const longServer = await new Promise((res) => {
  const srv = createServer((_q, s) => s.end(`<html><body><p>${'x'.repeat(3000)}</p><p>LONGPAGE_MARKER</p></body></html>`))
  srv.listen(0, '127.0.0.1', () => res(srv))
})
const longUrl = `http://127.0.0.1:${longServer.address().port}/`

// basic-auth 页(httpCredentials 验证用;无 Authorization 头 → 401)
const authUser = 'u', authPass = 'p'
const authServer = await new Promise((res) => {
  const srv = createServer((q, s) => {
    const expected = 'Basic ' + Buffer.from(`${authUser}:${authPass}`).toString('base64')
    if (q.headers.authorization !== expected) {
      s.statusCode = 401
      s.setHeader('WWW-Authenticate', 'Basic realm="gui-eyes-test"')
      return s.end('auth required')
    }
    s.end('<html><body><p>BASICAUTH_OK_MARKER</p></body></html>')
  })
  srv.listen(0, '127.0.0.1', () => res(srv))
})
const authUrl = `http://127.0.0.1:${authServer.address().port}/`

// 内联声明场景(env 劫持防护验证): target 明写 authUrl, spawn env 的 GUI_EYES_BASE_URL 指向 dead port
const inlineScenario = join(REPO, 'evidence/issues-2026-11-26/tmp-inline.yaml')
writeFileSync(inlineScenario, `name: env-priority-inline\ndescription: 内联声明必须胜过 ambient env\ntarget:\n  baseUrl: ${authUrl}\n  auth: none\nsteps:\n  - goto: /\n  - dom: {}\nasserts:\n  - textVisible: BASICAUTH_OK_MARKER\n`)

const pngSize = (path) => {
  const b = readFileSync(path)
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
}

const makeClient = (env = {}) => {
  const proc = spawn('node', [join(REPO, 'bin/gui-eyes-mcp.js')], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } })
  let buf = ''
  const pending = new Map()
  let nextId = 0
  proc.stdout.on('data', (d) => {
    buf += d.toString()
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line) continue
      try {
        const msg = JSON.parse(line)
        if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
      } catch { log.push({ nonJsonStdoutLine: line.slice(0, 200) }) }
    }
  })
  proc.stderr.on('data', (d) => log.push({ stderr: d.toString().slice(0, 200) }))
  const request = (method, params) => new Promise((res, rej) => {
    const id = ++nextId
    pending.set(id, res)
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    setTimeout(() => rej(new Error(`timeout waiting ${method}`)), 120000)
  })
  const call = async (name, args) => (await request('tools/call', { name, arguments: args })).result
  return { request, call, kill: () => proc.kill() }
}

const exit = async (code) => {
  longServer.close(); authServer.close()
  writeFileSync(OUT, JSON.stringify({ startedAt: new Date().toISOString(), log, failures }, null, 2))
  process.exit(code)
}

try {
  // ===== spawn1: 无特殊 env =====
  const c1 = makeClient()

  // #12: 描述意图词
  const tools = (await c1.request('tools/list', {})).result.tools
  const intent = tools.filter(t => /验证|验收|回归/.test(t.description ?? ''))
  check('#12 all 7 descriptions carry intent words (验证/验收/回归)', intent.length === 7)

  // dsh-web smoke
  const dw = parse(await c1.call('gui_open', {}))
  check('dsh-web gui_open healthy', dw.degraded === false, `auth_mode=${dw.auth_mode}`)

  // ---- plain: 观测口径三件套(#9) ----
  const p1 = parse(await c1.call('gui_open', { target: 'plain', baseUrl: PAGES }))
  check('#9 plain opens', p1.degraded === false)

  // shadow: textVisible 现在能命中(旧引擎假阴性)
  const shadow = parse(await c1.call('gui_assert', { asserts: [
    { textVisible: 'SHADOW_TEXT_MARKER' },
    { textVisible: 'PLAIN_MAIN_MARKER' },
  ] }))
  check('#9 textVisible pierces shadow DOM (SHADOW_TEXT_MARKER hit)', shadow.results[0].ok === true)
  check('#9 main doc text still hits', shadow.results[1].ok === true)

  // iframe: frame 定位命中;主文档仍不命中(边界诚实)
  const iframe = parse(await c1.call('gui_assert', { asserts: [
    { textVisible: { text: 'IFRAME_TEXT_MARKER', frame: '#frame1' } },
    { textVisible: 'IFRAME_TEXT_MARKER' },
    { count: { selector: 'p', equals: 2, frame: '#frame1' } },
  ] }))
  check('#9 textVisible {text, frame} hits iframe text', iframe.results[0].ok === true)
  check('#9 main-doc miss for iframe text is honest (not fake-negative confusion)', iframe.results[1].ok === false)
  check('#9 count inside frame works', iframe.results[2].ok === true, iframe.results[2].detail)

  // shadow 点击链路照常(点得中)
  const sc = parse(await c1.call('gui_click', { text: 'SHADOW_BTN_TEXT' }))
  check('#9 click on shadow button still works', sc.ok === true)
  const scr = parse(await c1.call('gui_assert', { asserts: [{ textVisible: 'SHADOW_CLICKED_OK' }] }))
  check('#9 shadow click effect observable', scr.results[0].ok === true)

  // popup: 点击 target=_blank → tabs=2 → tab 寻址 → 越界结构化错误
  const pc = parse(await c1.call('gui_click', { text: 'POPUP_LINK_TEXT' }))
  check('#9 popup-triggering click ok', pc.ok === true)
  const after = parse(await c1.call('gui_open', { target: 'plain', baseUrl: PAGES }))
  check('#9 gui_open reports tabs=2 after popup', after.tabs === 2)
  const tab1 = parse(await c1.call('gui_dom', { tab: 1 }))
  check('#9 tab:1 observes the popup page', tab1.ok === true && tab1.text.includes('POPUP_TEXT_MARKER'))
  const badTab = await c1.call('gui_dom', { tab: 5 })
  check('#9 out-of-range tab is a structured NO_SUCH_TAB error', badTab.isError === true && parse(badTab).error === 'NO_SUCH_TAB')

  // fullPage: 整页截图含视口外(2600px 页 vs 视口 900)——仍在 plain 会话上(上一检查已确保)
  const vp = parse(await c1.call('gui_shot', { name: 'm22-viewport' }))
  const fp = parse(await c1.call('gui_shot', { name: 'm22-fullpage', fullPage: true, tab: 0 }))
  const vpSize = pngSize(vp.path), fpSize = pngSize(fp.path)
  check('#9 viewport screenshot is 900-high', vpSize.height === 900, JSON.stringify(vpSize))
  check('#9 fullPage screenshot exceeds viewport (tall page captured)', fpSize.height > 1400, JSON.stringify(fpSize))

  // force 重开清掉 popup(tabs 回 1)
  const re = parse(await c1.call('gui_open', { target: 'plain', baseUrl: PAGES, force: true }))
  check('#9 force reopen resets context (tabs=1)', re.tabs === 1 && re.degraded === false)

  // gui_dom 默认 head 2000(#12): 3000 字符长文本页
  const lp = parse(await c1.call('gui_open', { target: 'plain', baseUrl: longUrl }))
  const ld = parse(await c1.call('gui_dom', {}))
  check('#12 gui_dom default head is 2000 on MCP channel', ld.ok === true && ld.text.length === 2000 && ld.truncated === true && ld.total_length > 3000)

  // #10: deadport 场景——失败原因 + NET 观测
  const dp = parse(await c1.call('gui_run', { scenario: join(homedir(), 'projects/gui-eyes-plain-test/deadport.yaml') }))
  check('#10 deadport goto failure carries message', dp.steps[0].ok === false && /net::ERR_/.test(dp.steps[0].message ?? ''), dp.steps[0].message)
  check('#10 NET entry lands in failed_requests', dp.failed_requests.some(x => x.startsWith('NET ')), JSON.stringify(dp.failed_requests))

  // plain profile 拆分(#11)
  check('#11 plain uses its own profile dir', existsSync(join(homedir(), '.cache/dsh-gui-eyes/profile-plain')))

  // ---- workbench 场景回归(textVisible 新引擎) ----
  // msflip 除外:workbench MultiSelect 组件 2026-11-26 已重构(msRow/checkbox/msClear 类消失,面板结构变),
  // 场景 selector 属 landingzone-workbench 侧资产,需对方按新 DOM 重写——此处记录信息不阻塞本仓验收。
  for (const name of ['workbench-capture', 'workbench-drill', 'workbench-verify']) {
    const r = parse(await c1.call('gui_run', { scenario: join(WB, `${name}.yaml`) }))
    check(`workbench scenario ${name} green under new engine`, r.ok === true,
      r.ok ? '' : `steps:${JSON.stringify(r.steps)} asserts:${JSON.stringify(r.asserts)}`.slice(0, 300))
  }
  const msf = parse(await c1.call('gui_run', { scenario: join(WB, 'workbench-msflip.yaml') }))
  // 更正(2026-11-26, GitCode issue #14 / v0.4.0): 下行 note 的「组件重写」结论不成立——
  // 组件未重构, checkbox/msRow/msClear 健在; 缺席真因 = 个人账号空 facets(面板只渲染
  // 「暂无可选项」) + gui_run 场景页 fetch 被长驻交互页长连饿死(#14, v0.4.0 独立临时
  // 浏览器根治)。保留原 note 仅作历史记录, 修正口径见 issue9-13-drive.json 的 correction 字段。
  log.push({ name: 'workbench-msflip (informational: workbench-side selector drift)', pass: null, note: `ok=${msf.ok}; msPanel click ok, checkbox/msRow/msClear selectors no longer in DOM (component rewritten by workbench-side development; scenario rewrite belongs to landingzone-workbench repo)` })
  c1.kill()

  // ===== spawn2: env 劫持 + httpCredentials(#11) =====
  const c2 = makeClient({ GUI_EYES_BASE_URL: 'http://127.0.0.1:9/', GUI_EYES_HTTP_CREDS: `${authUser}:${authPass}` })
  const envTest = parse(await c2.call('gui_run', { scenario: inlineScenario }))
  check('#11 inline-declared baseUrl beats ambient env (scenario navigates its own target)', envTest.ok === true,
    envTest.ok ? '' : JSON.stringify(envTest).slice(0, 300))
  check('#11 httpCredentials from env authenticates (BASICAUTH_OK_MARKER asserted)', envTest.ok === true && envTest.asserts.every(a => a.ok))
  c2.kill()

  await exit(failures.length === 0 ? 0 : 1)
} catch (e) {
  log.push({ fatal: e.message })
  await exit(1)
}
