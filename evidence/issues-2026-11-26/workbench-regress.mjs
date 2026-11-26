// workbench 迁出场景经新 gui_run(newPage 隔离)端到端回归
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const REPO = '/home/x30070689/projects/dsh-gui-eyes'
const SC = '/home/x30070689/projects/landingzone-workbench/.dsh/gui-scenarios/workbench-capture.yaml'
const proc = spawn('node', [REPO + '/bin/gui-eyes-mcp.js'], { stdio: ['pipe', 'pipe', 'pipe'] })
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
    } catch {}
  }
})
const request = (method, params) => new Promise((res, rej) => {
  const id = ++nextId
  pending.set(id, res)
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  setTimeout(() => rej(new Error(`timeout ${method}`)), 120000)
})
const call = async (name, args) => (await request('tools/call', { name, arguments: args })).result

const r1 = JSON.parse((await call('gui_run', { scenario: SC })).content[0].text)
const r2 = JSON.parse((await call('gui_dom', { head: 300 })).content[0].text)
const out = { gui_run: { ok: r1.ok, steps: r1.steps, shots: r1.shots, body_text_head: (r1.body_text_head ?? '').slice(0, 120) }, interactive_after: { text_head: r2.text.slice(0, 120) } }
writeFileSync(REPO + '/evidence/issues-2026-11-26/workbench-regress.json', JSON.stringify(out, null, 2))
console.log(JSON.stringify(out, null, 2))
proc.kill()
process.exit(0)
