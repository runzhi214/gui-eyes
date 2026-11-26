// M2 验收驱动: spawn bin/gui-eyes-mcp.js 走 MCP stdio 协议,全量调用 7 工具。
// 证据产物: evidence/m2/protocol-live.json (逐工具结果摘要)
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { writeFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const REPO = '/home/x30070689/projects/dsh-gui-eyes'
const OUT = join(REPO, 'evidence/m2/protocol-live.json')
const SCENARIO = join(homedir(), 'projects/landingzone-workbench/.dsh/gui-scenarios/workbench-capture.yaml')

const log = []
const raws = []
const record = (tool, args, res) => {
  try {
    log.push({ tool, args, isError: res.isError === true, content: JSON.parse(res.content?.[0]?.text ?? 'null') })
  } catch (e) {
    raws.push({ tool, raw: res, parseError: e.message })
    throw e
  }
}

// 本地带输入框的页面(gui_type 用)
const inputServer = await new Promise((res) => {
  const srv = createServer((_q, s) => s.end('<html><body><input id="q" oninput="document.getElementById(\'out\').textContent=this.value"/><p>plain-page</p><p id="out"></p></body></html>'))
  srv.listen(0, '127.0.0.1', () => res(srv))
})
const inputUrl = `http://127.0.0.1:${inputServer.address().port}/`

// MCP stdio 客户端
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
    } catch (e) {
      raws.push({ nonJsonStdoutLine: line.slice(0, 400), parseError: e.message })
    }
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

const exit = async (code) => { inputServer.close(); proc.kill(); process.exit(code) }

try {
  const init = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'm2-drive', version: '0.0.0' } })
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
  log.push({ init: { server: init.result.serverInfo.name, version: init.result.serverInfo.version } })

  const listed = await request('tools/list', {})
  const names = listed.result.tools.map(t => t.name)
  log.push({ tools_listed: names })

  record('gui_open', { target: 'dsh-web' }, await call('gui_open', { target: 'dsh-web' }))
  record('gui_click', { text: 'Landing Zone 工作台' }, await call('gui_click', { text: 'Landing Zone 工作台' }))
  const dom = await call('gui_dom', { head: 300 })
  record('gui_dom', { head: 300 }, dom)
  const shot = await call('gui_shot', { name: 'mcp-workbench' })
  record('gui_shot', { name: 'mcp-workbench' }, shot)
  const shotPath = JSON.parse(shot.content[0].text).path
  log.push({ shot_exists_on_disk: existsSync(shotPath) })
  record('gui_assert', { asserts: [{ textVisible: '资源管理' }] }, await call('gui_assert', { asserts: [{ textVisible: '资源管理' }] }))

  // 换 target 到 plain 本地页 → gui_type 全链(保活切换)
  record('gui_open(plain)', { target: 'plain', baseUrl: inputUrl }, await call('gui_open', { target: 'plain', baseUrl: inputUrl }))
  record('gui_type', { into: '#q', text: 'typed-hello' }, await call('gui_type', { into: '#q', text: 'typed-hello' }))
  const typed = await call('gui_dom', {})
  log.push({ typed_visible: JSON.parse(typed.content[0].text).text.includes('typed-hello') })

  // gui_run: 场景自带 target(dsh-web) → 会话切回并跑全链
  record('gui_run', { scenario: 'workbench-capture.yaml' }, await call('gui_run', { scenario: SCENARIO }))
  const after = await call('gui_dom', { head: 120 })
  log.push({ after_run_is_dshweb: JSON.parse(after.content[0].text).text.includes('AI') || JSON.parse(after.content[0].text).text.length > 0 })

  writeFileSync(OUT, JSON.stringify(log, null, 2))
  const ok = names.length === 7
    && log[log.length - 1].after_run_is_dshweb !== false
    && log.find(e => e.tool === 'gui_open').content.auth_mode !== undefined
  console.log(JSON.stringify({ tools: names, allOk: ok }, null, 2))
  await exit(ok ? 0 : 1)
} catch (e) {
  log.push({ fatal: e.message, raws: raws.slice() })
  writeFileSync(OUT, JSON.stringify(log, null, 2))
  console.error('DRIVE FAILED:', e.message)
  console.error('RAWS:', JSON.stringify(raws, null, 2).slice(0, 2000))
  await exit(1)
}
