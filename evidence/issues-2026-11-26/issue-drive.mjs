// 2026-11-26 issue 修复活体验收驱动: spawn 新代码的 MCP server, 真机覆盖 #1–#8 修复行为。
// 证据产物: evidence/issues-2026-11-26/issue-drive.json
// 红线: token 文件内容不回显、不落日志; TOKEN_STALE 组先切 plain 会话释放 profile 再动目录。
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { writeFileSync, existsSync, rmSync, mkdtempSync, copyFileSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const REPO = '/home/x30070689/projects/dsh-gui-eyes'
const OUT = join(REPO, 'evidence/issues-2026-11-26/issue-drive.json')
const HOME = homedir()
const TOKEN_FILE = join(HOME, '.dsh-gui-token')
const PROFILE_DIR = join(HOME, '.cache/dsh-gui-eyes/profile')
const SCENARIO_PLAIN = join(REPO, 'evidence/issues-2026-11-26/tmp-plain.yaml')

const log = []
const failures = []
const check = (name, cond, note = '') => {
  log.push({ name, pass: cond === true, ...(note ? { note } : {}) })
  if (cond !== true) failures.push(name)
}
const parse = (res) => JSON.parse(res.content?.[0]?.text ?? 'null')

// ---- 本地 plain 页(带输入框与回显, click/type/隔离全用一个页) ----
const PAGE_HTML = `<html><body><button id="btn">plain-page</button><input id="q" oninput="document.getElementById('out').textContent=this.value"/><p>plain-page</p><p id="out"></p></body></html>`
const inputServer = await new Promise((res) => {
  const srv = createServer((_q, s) => s.end(PAGE_HTML))
  srv.listen(0, '127.0.0.1', () => res(srv))
})
const inputUrl = `http://127.0.0.1:${inputServer.address().port}/`

// 隔离验证场景: 与交互会话同 baseUrl(inline target), 场景页独立 type, 不应扰动交互页
writeFileSync(SCENARIO_PLAIN, `name: issue-drive-plain\ndescription: 隔离验证场景\ntarget:\n  baseUrl: ${inputUrl}\n  auth: none\nsteps:\n  - goto: /\n  - wait: 300\n  - type: { into: "#q", text: "scenario-input" }\n  - dom: {}\nasserts:\n  - textVisible: scenario-input\n`)

// ---- MCP stdio 客户端 ----
const proc = spawn('node', [join(REPO, 'bin/gui-eyes-mcp.js')], { stdio: ['pipe', 'pipe', 'pipe'] })
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

const backupDir = mkdtempSync(join(tmpdir(), 'gui-eyes-issue-drive-'))
const exit = async (code) => {
  inputServer.close()
  rmSync(SCENARIO_PLAIN, { force: true })
  proc.kill()
  writeFileSync(OUT, JSON.stringify({ startedAt: new Date().toISOString(), log, failures, backupDir }, null, 2))
  process.exit(code)
}

try {
  // #8: 工具描述警示行
  const tools = (await request('tools/list', {})).result.tools
  check('#8 seven tools registered', tools.length === 7)
  const withWarning = tools.filter(t => (t.description ?? '').includes('不受会话权限模式'))
  check('#8 all 7 descriptions carry the safety note', withWarning.length === 7)

  // ---- A 组: dsh-web 真机 ----
  const a1 = parse(await call('gui_open', {}))
  check('#1 gui_open reports degraded:false on a healthy page', a1.degraded === false, `auth_mode=${a1.auth_mode}`)
  check('#1 gui_open title/body non-empty', a1.title !== '' && a1.body_text_head !== '')
  check('#3 gui_open auth established', a1.auth_mode === 'cookie' || a1.auth_mode === 'token-bootstrap')

  const a2 = parse(await call('gui_dom', { head: 50 }))
  check('#6 gui_dom carries total_length/truncated', typeof a2.total_length === 'number' && a2.truncated === true && a2.text.length === 50)

  const a3 = parse(await call('gui_assert', { asserts: [{ count: { selector: 'button[', equals: 0 } }] }))
  check('#1 count with bad selector fails as 执行异常 (no fake green)', a3.ok === false && a3.results[0].ok === false && a3.results[0].detail.includes('执行异常'), a3.results[0].detail.slice(0, 80))

  const a4 = parse(await call('gui_shot', { name: 'issue-drive' }))
  check('#6 gui_shot returns dated-subdir absolute path', a4.ok === true && /\/shots\/\d{4}-\d{2}-\d{2}\/issue-drive-\d+\.png$/.test(a4.path))
  check('#1 gui_shot path really exists on disk', existsSync(a4.path))

  const a5 = parse(await call('gui_open', { force: true }))
  check('#2 force reopen returns a healthy report', a5.degraded === false)

  // ---- B 组: plain 本地页 ----
  const b0 = await call('gui_open', { target: 'plain' })
  check('#6 plain without baseUrl is a structured error', b0.isError === true && parse(b0).error === 'PLAIN_BASE_URL_MISSING')

  const b1 = parse(await call('gui_open', { target: 'plain', baseUrl: inputUrl }))
  check('#6 plain with explicit baseUrl opens', b1.degraded === false && b1.auth_mode === 'none')

  const b2 = parse(await call('gui_type', { locate: { selector: '#q' }, text: 'interactive-input' }))
  check('#4 gui_type works via locate selector', b2.ok === true && b2.matches === 1, JSON.stringify(b2).slice(0, 120))

  const b3 = parse(await call('gui_dom', {}))
  check('#4 gui_type actually filled (echo present)', b3.text.includes('interactive-input'))

  const b4 = parse(await call('gui_click', { text: 'plain-page' }))
  check('#4 gui_click returns matches audit', b4.ok === true && b4.matches >= 1 && typeof b4.matched_text === 'string', JSON.stringify({ matches: b4.matches, matched_text: b4.matched_text }))

  const b5 = parse(await call('gui_click', { text: '不存在的文案xyz' }))
  check('#1 gui_click not-found is fast and classified', b5.ok === false && b5.error === 'not-found')

  // ---- C 组: gui_run 隔离(同 baseUrl, 不扰动交互页) ----
  const c1 = parse(await call('gui_run', { scenario: SCENARIO_PLAIN }))
  check('#5 gui_run ok with asserts green', c1.ok === true)
  check('#5 gui_run response carries body_text_head', typeof c1.body_text_head === 'string' && c1.body_text_head.includes('scenario-input'))

  const c2 = parse(await call('gui_dom', {}))
  check('#5 interactive page untouched by gui_run (still interactive-input, not scenario-input)', c2.text.includes('interactive-input') && !c2.text.includes('scenario-input'))

  // ---- D 组: TOKEN_STALE(先切 plain 释放 profile; 最后执行) ----
  const tokenBackup = join(backupDir, 'token.bak')
  if (existsSync(TOKEN_FILE)) copyFileSync(TOKEN_FILE, tokenBackup)
  const hadToken = existsSync(TOKEN_FILE)
  writeFileSync(TOKEN_FILE, 'http://127.0.0.1:3080/?token=dead-token-for-issue3-test\n')
  rmSync(PROFILE_DIR, { recursive: true, force: true })
  const d1 = await call('gui_open', { target: 'dsh-web' })
  check('#3 stale token reports TOKEN_STALE, not fake token-bootstrap', d1.isError === true && parse(d1).error === 'TOKEN_STALE', JSON.stringify(parse(d1)).slice(0, 160))

  // 恢复真 token, 重铸应成功且复验通过
  rmSync(PROFILE_DIR, { recursive: true, force: true })
  if (hadToken) copyFileSync(tokenBackup, TOKEN_FILE)
  const d2 = parse(await call('gui_open', { target: 'dsh-web' }))
  check('#3 live token re-mints and passes re-verify', d2.auth_mode === 'token-bootstrap' && d2.degraded === false, `auth_mode=${d2.auth_mode} degraded=${d2.degraded}`)

  await exit(failures.length === 0 ? 0 : 1)
} catch (e) {
  log.push({ fatal: e.message })
  await exit(1)
}
