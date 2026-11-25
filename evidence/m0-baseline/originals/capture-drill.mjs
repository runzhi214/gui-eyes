#!/usr/bin/env node
/** P1 下钻采集:进工作台 → 点 IaC 团队排名行 → 截账号口径明细,DOM 文本核对 ep_name。 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const require = createRequire('/home/x30070689/projects/AI_Shell_WEB/package.json')
const { chromium } = require('playwright')

const HOME = homedir()
const PROFILE_DIR = join(HOME, '.cache/dsh-gui-eyes/profile')
const SHOTS_DIR = join(HOME, 'projects/dsh-gui-eyes/shots')
mkdirSync(SHOTS_DIR, { recursive: true })

const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: true,
  viewport: { width: 1440, height: 900 },
})
const page = context.pages()[0] ?? (await context.newPage())
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })

await page.goto('http://127.0.0.1:3080/', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {})
await page.waitForTimeout(6000)
const body = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')
if (body.includes('authentication required')) {
  console.log(JSON.stringify({ error: 'NO_COOKIE', hint: '重启后 cookie 失效?需重新 bootstrap token' }))
  await context.close()
  process.exit(2)
}

// 进工作台面板
await page.getByText('Landing Zone 工作台').first().click({ timeout: 8000 }).catch(() => {})
await page.waitForTimeout(4000)

// 重启后默认落在治理总览:先进「资源管理」菜单
await page.getByText('资源管理', { exact: true }).first().click({ timeout: 8000 }).catch(() => {})
await page.waitForTimeout(5000)

// 下钻:IaC 团队(排名行标签 = 账号名)
const clicked = await page.getByText('es_hwcddbdt_IaC_team').first().click({ timeout: 8000 })
  .then(() => true).catch(() => false)
await page.waitForTimeout(4500) // 明细列表取数
const shot = join(SHOTS_DIR, `iac-ep-${Date.now()}.png`)
await page.screenshot({ path: shot })

const text = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')
const names = ['Iac实践中心Web项目', '褚蕴威', '陈伟凯', '李勃然', 'devbox-test', 'devimage', 'multica']
const found = names.filter(n => text.includes(n))
console.log(JSON.stringify({
  clicked_rank_row: clicked,
  ep_names_visible: found,
  body_head: text.slice(0, 500),
  console_errors: errors.slice(0, 5),
  shot,
}, null, 2))
await context.close()
