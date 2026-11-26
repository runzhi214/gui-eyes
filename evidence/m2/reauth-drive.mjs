// M2 验收②③驱动:
//  ② 删 ~/.cache/dsh-gui-eyes/profile 模拟 cookie 失效, token 在场 → gui_open 自动重铸(auth_mode: token-bootstrap)
//  ③ 删 profile + 藏 token → gui_open 结构化 NO_TOKEN(不崩溃); 同一 server 再调 gui_dom 得 NO_SESSION(证明进程存活)
//  末尾恢复: token 归位 + 重铸, 现场留健康 cookie
// 证据: evidence/m2/reauth-drive.json
import { spawn } from 'node:child_process'
import { writeFileSync, existsSync, renameSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const REPO = '/home/x30070689/projects/dsh-gui-eyes'
const PROFILE = join(homedir(), '.cache/dsh-gui-eyes/profile')
const TOKEN = join(homedir(), '.dsh-gui-token')
const TOKEN_BAK = TOKEN + '.bak'
const OUT = join(REPO, 'evidence/m2/reauth-drive.json')
const log = []
const parse = (r) => JSON.parse(r.content[0].text)

const withFreshServer = async (fn) => {
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
      const msg = JSON.parse(line)
      if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
    }
  })
  const request = (method, params) => new Promise((res, rej) => {
    const id = ++nextId
    pending.set(id, res)
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    setTimeout(() => rej(new Error('timeout ' + method)), 120000)
  })
  await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'm2-reauth', version: '0.0.0' } })
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
  const call = async (name, args) => (await request('tools/call', { name, arguments: args })).result
  try {
    return await fn(call)
  } finally {
    proc.kill()
    await new Promise((r) => setTimeout(r, 500))
  }
}

// ---- 验收②: cookie 失效自动重铸 ----
// 诚实判据: auth_mode=token-bootstrap 且重铸后页面正文无 401 文案(防 token 死时假绿)
const authed = (report) => !String(report.body_text_head ?? '').includes('authentication required')
if (!existsSync(TOKEN)) throw new Error('token 文件不在场, 验收②前置失败')
rmSync(PROFILE, { recursive: true, force: true })
const phaseA = await withFreshServer(async (call) => {
  const res = await call('gui_open', { target: 'dsh-web' })
  return { isError: res.isError === true, report: parse(res) }
})
log.push({
  acceptance: '② cookie 失效(profile 删除) + token 在场 → 自动重铸',
  profile_deleted_before: true,
  auth_mode: phaseA.report.auth_mode,
  body_head_120: String(phaseA.report.body_text_head ?? '').slice(0, 120),
  pass: phaseA.isError === false && phaseA.report.auth_mode === 'token-bootstrap' && authed(phaseA.report),
})

// ---- 验收③: 无 token → 结构化 NO_TOKEN, 进程不崩 ----
rmSync(PROFILE, { recursive: true, force: true })
renameSync(TOKEN, TOKEN_BAK)
const phaseB = await withFreshServer(async (call) => {
  const open = await call('gui_open', { target: 'dsh-web' })
  const dom = await call('gui_dom', { head: 50 })
  return { open: { isError: open.isError === true, body: parse(open) }, dom: { isError: dom.isError === true, body: parse(dom) } }
})
renameSync(TOKEN_BAK, TOKEN)
log.push({
  acceptance: '③ 无 token → 结构化 NO_TOKEN; 同 server 后续调用得 NO_SESSION(进程存活)',
  open_result: phaseB.open.body,
  dom_after_failure: phaseB.dom.body,
  pass: phaseB.open.body.error === 'NO_TOKEN' && phaseB.dom.body.error === 'NO_SESSION',
})

// ---- 恢复现场: 重铸一枚健康 cookie ----
const phaseC = await withFreshServer(async (call) => {
  const res = await call('gui_open', { target: 'dsh-web' })
  return parse(res)
})
log.push({
  acceptance: '现场恢复: token 归位 + 重铸',
  auth_mode: phaseC.auth_mode,
  token_restored: existsSync(TOKEN),
  pass: phaseC.auth_mode === 'token-bootstrap' || phaseC.auth_mode === 'cookie',
})

writeFileSync(OUT, JSON.stringify(log, null, 2))
const allPass = log.every((e) => e.pass)
console.log(JSON.stringify(log.map((e) => ({ acceptance: e.acceptance, pass: e.pass })), null, 2))
process.exit(allPass ? 0 : 1)
