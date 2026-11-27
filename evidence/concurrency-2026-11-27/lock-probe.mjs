// #26 并发证伪探针(2026-11-27): 同 profile 目录双 persistent context。
// 结论: 两个 context 均可启动,各自导航/读取互不干扰,关一个另一个照活——
// 「多 MCP 会话并发撞 chromium singleton 锁」的缺陷前提不成立。
// 复现: node evidence/concurrency-2026-11-27/lock-probe.mjs
import { chromium } from 'playwright'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'lockprobe-'))
const c1 = await chromium.launchPersistentContext(dir, { headless: true })
const c2 = await chromium.launchPersistentContext(dir, { headless: true })
console.log('both contexts up')
const p1 = await c1.newPage(); const p2 = await c2.newPage()
await p1.goto('data:text/html,<h1>one</h1>'); await p2.goto('data:text/html,<h1>two</h1>')
console.log('p1 text:', (await p1.locator('body').innerText()).trim())
console.log('p2 text:', (await p2.locator('body').innerText()).trim())
await p1.goto('data:text/html,<h1>oneB</h1>')
console.log('after p2 exists, p1 text:', (await p1.locator('body').innerText()).trim())
console.log('p2 still:', (await p2.locator('body').innerText()).trim())
await c1.close()
try { console.log('p2 after c1 close:', (await p2.locator('body').innerText()).trim()) } catch (e) { console.log('p2 broken after c1 close:', String(e).slice(0, 120)) }
await c2.close()
rmSync(dir, { recursive: true, force: true })
