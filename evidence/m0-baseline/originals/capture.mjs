#!/usr/bin/env node
/**
 * P1 采集器 PoC —— 截图 DSH Web GUI(127.0.0.1:3080)。
 *
 * 鉴权(读 dsh-client-connection/src/browser-auth.ts 得证):
 *   - launch token 一次性,只打在 dsh web 的终端里(不落盘);
 *   - GET /?token=... → 303 换 30 天 HMAC cookie(cookieMaxAgeDays=30);
 *   - 持久 profile 存 cookie → bootstrap 一次,30 天内免 token。
 *
 * 用法: node capture.mjs
 *   token 文件: ~/.dsh-gui-token 或 /tmp/dsh-gui-token(内容=dsh web 打印的完整 URL);
 *   不进 argv、不回显;cookie 落 ~/.cache/dsh-gui-eyes/profile。
 * 输出: shots/root-*.png + shots/workbench-*.png + stdout JSON(标题/错误/失败请求/正文头)。
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const require = createRequire('/home/x30070689/projects/AI_Shell_WEB/package.json')
const { chromium } = require('playwright')

const HOME = homedir()
const TOKEN_FILES = [join(HOME, '.dsh-gui-token'), '/tmp/dsh-gui-token']
const PROFILE_DIR = join(HOME, '.cache/dsh-gui-eyes/profile')
const SHOTS_DIR = join(HOME, 'projects/dsh-gui-eyes/shots')
const BASE_URL = 'http://127.0.0.1:3080/'

const readTokenUrl = () => {
  for (const f of TOKEN_FILES) {
    if (existsSync(f)) {
      const raw = readFileSync(f, 'utf8').trim()
      if (raw.startsWith('http')) return raw
    }
  }
  return null
}

const mask = (s) => s.replace(/token=[^&\s']*/g, 'token=***')

const main = async () => {
  mkdirSync(SHOTS_DIR, { recursive: true })
  mkdirSync(PROFILE_DIR, { recursive: true })
  const tokenUrl = readTokenUrl()

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    viewport: { width: 1440, height: 900 },
  })
  const page = context.pages()[0] ?? (await context.newPage())
  const consoleErrors = []
  const failedRequests = []
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)) })
  page.on('response', r => {
    const u = mask(r.url())
    if (r.status() >= 400 && !u.includes('/api/')) failedRequests.push(`HTTP ${r.status()} ${u}`)
    else if (r.status() >= 400) failedRequests.push(`HTTP ${r.status()} ${u.slice(0, 120)}`)
  })

  // 先试持久 cookie;401 文案出现且 token 文件在 → 用 token 重新换 cookie
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {})
  const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')
  let authMode = 'cookie'
  if (bodyText.includes('authentication required')) {
    if (tokenUrl === null) {
      console.log(JSON.stringify({ error: 'NO_TOKEN', hint: '把 dsh web 终端里的完整 URL 写入 ~/.dsh-gui-token(一行)' }, null, 2))
      await context.close()
      process.exit(2)
    }
    authMode = 'token-bootstrap'
    await page.goto(tokenUrl, { waitUntil: 'domcontentloaded', timeout: 20000 })
  }

  // SPA 渲染等待
  await page.waitForTimeout(6000)
  const shots = []
  const rootShot = join(SHOTS_DIR, `root-${Date.now()}.png`)
  await page.screenshot({ path: rootShot })
  shots.push(rootShot)

  // 导航:侧边栏「Landing Zone 工作台」(PANEL_ID='workbench',label 见 client/index.ts:136)
  let clicked = false
  try {
    await page.getByText('Landing Zone 工作台').first().click({ timeout: 5000 })
    clicked = true
  } catch { /* 侧边栏未展开/文案变化 → 只交 root 截图 */ }
  if (clicked) {
    await page.waitForTimeout(5000) // 面板挂载 + 首屏 API 取数
    const wbShot = join(SHOTS_DIR, `workbench-${Date.now()}.png`)
    await page.screenshot({ path: wbShot })
    shots.push(wbShot)
  }

  const finalText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')
  console.log(JSON.stringify({
    auth_mode: authMode,
    final_url: mask(page.url()),
    title: await page.title(),
    clicked_workbench: clicked,
    console_errors: consoleErrors.slice(0, 10),
    failed_requests: failedRequests.slice(0, 15),
    body_text_head: clicked ? finalText.slice(0, 600) : finalText.slice(0, 300),
    shots,
  }, null, 2))
  await context.close()
}

main().catch(e => { console.error('capture failed:', e.message); process.exit(1) })
